import fs from 'fs/promises';
import path from 'path';
import { ZodError } from 'zod';
import { AgentConfig, Message, TaskEnvelope, TaskResult, ToolCall, ToolResult } from '../types';
import { toolRegistry } from '../tools/registry';
import { memoryStore } from '../db/memory';
import { vectorStore } from '../db/vectorStore';
import { logger } from '../utils/logger';
import { AgentFactory } from './factory';
import { assessToolRisk } from './guardian';
import { findRelevantExperience, saveExperience } from './memory';
import { soulStore } from '../runtime/soulStore';
import { modelRouter, ModelTier } from '../models/modelRouter';
import { ollamaChatProvider } from '../models/ollama';
import { chatWithGemini } from '../models/gemini';
import { sessionStore } from '../runtime/sessionStore';
import { chatWithFallback } from '../models/runtime';
import { config } from '../config';
import { AuthorizationRequester } from '../gateways/base';

const AUTONOMOUS_AGENT_SYSTEM_PROMPT = `You are OpenMac, an elite autonomous agent for macOS. You are precise, helpful, and sophisticated. Use the  OpenMac signature in final responses.

### 🧠 SELF-IMPROVING RULES:
1. **Learn from Corrections:** If the user says "No, do X instead" or "Actually...", you MUST call \`log_correction\` immediately.
2. **Self-Reflection:** After every complex task, call \`log_reflection\` to capture what went well and what could be better.
3. **Compound Knowledge:** Check your WARM memory for context-specific patterns before acting.
4. **The 3x Rule:** If you use a pattern 3 times successfully, propose adding it to your HOT memory via \`update_soul\`.
`;

const MANAGER_SYSTEM_PROMPT = `You are the Task Manager. Inspect the task, choose the best sub-agent, and supervise execution.
Available sub-agents:
- Researcher Agent: investigations, reading, synthesis, context gathering.
- Coder Agent: code changes, filesystem edits, debugging, implementation.
- System Agent: macOS settings, hardware control, media playback.

Behavior:
1. Provide Thought: and Plan:
2. Call tools to execute.
3. Provide Reflection: after tool results.
4. Provide Finished: with the final result.
`;

const TELEGRAM_RESPONSE_PROMPT = `Format your response for Telegram using MarkdownV2. Use bold for key information and code blocks for logs. Use emojis for readability. End with a subtle  OpenMac signature. Put the user-facing message on the Finished: line using Markdown-friendly formatting.`;

const TOOL_FAILURE_RECOVERY_PROMPT = 'The previous tool call failed. Analyze the error, correct your parameters, and try again.';
const APPLESCRIPT_HEALING_PROMPT = 'The previous AppleScript call failed. This usually means the application dictionary or syntax has changed. Search the web for the latest AppleScript syntax for this application or use the dictionary tool if available, then fix the script and retry.';

const MAX_REASONING_STEPS = 24;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanModelOutput(content: string): string {
  return content.replace(/<channel▷/g, '').replace(/<\|[\s\S]*?\|>/g, '').trim();
}

function extractFinishedContent(content: string): string {
  const cleaned = cleanModelOutput(content);
  const match = cleaned.match(/(^|\n)Finished\s*:\s*([\s\S]*)$/i);
  return match?.[2]?.trim() || cleaned.trim();
}

function hasThought(content: string): boolean {
  return /(^|\n)Thought\s*:/i.test(content);
}

function formatSchemaValidationError(error: ZodError): string {
  return error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
}

function formatToolError(name: string, args: string, error: string): string {
  return `Tool ${name} failed with arguments ${args}. Error: ${error}`;
}

function formatToolResult(name: string, args: any, result: ToolResult | any): string {
  const data = result.success ? (result.result || result.data) : (result.error || result.message);
  return `Tool ${name} finished. Result: ${typeof data === 'string' ? data : JSON.stringify(data)}`;
}

function matchFastPath(prompt: string): null {
  // Placeholder for fast path logic if needed
  return null;
}

export class Orchestrator {
  private readonly activeAgent: AgentConfig;
  private readonly factory: AgentFactory;
  private readonly authorizers = new Map<string, AuthorizationRequester>();

  constructor(agent: AgentConfig) {
    this.activeAgent = agent;
    this.factory = new AgentFactory(agent.model, agent.tools);
  }

  registerAuthorizer(source: string, authorizer: AuthorizationRequester) {
    this.authorizers.set(source, authorizer);
  }

  async processTask(task: TaskEnvelope): Promise<TaskResult> {
    try {
      logger.debug(`Orchestrator starting task ${task.id}`);
      const fastPath = await this.tryFastPath(task);
      if (fastPath) {
        return fastPath;
      }

      const subAgentKind = this.factory.choose(task.prompt, task.metadata);
      const subAgent = this.factory.create(subAgentKind);
      const sessionModel = sessionStore.getSession(task).settings.model;
      if (sessionModel) {
        subAgent.model = sessionModel;
      }

      logger.system(`Manager delegating ${task.id} from ${task.source} to ${subAgent.name}`);
      const managerNote = `Task source: ${task.source}. Selected sub-agent: ${subAgent.name}. Reason: ${subAgentKind} is the best fit for this task.`;
      const response = await this.runSubAgent(subAgent, task, managerNote);
      const deliveryResponse = task.source === 'telegram'
        ? extractFinishedContent(response)
        : response;

      await vectorStore.store({
        source: `${task.source}:${task.id}`,
        scope: 'chat',
        content: `Prompt: ${task.prompt}\n\nResponse: ${deliveryResponse}`,
        metadata: {
          taskId: task.id,
          source: task.source,
          sourceId: task.sourceId,
          sessionKey: sessionStore.getSessionKey(task),
          sourceKey: sessionStore.getSourceKey(task.source),
          subAgent: subAgent.name,
        },
      });

      const downloadedImagePath = typeof task.metadata?.downloadedImagePath === 'string'
        ? task.metadata.downloadedImagePath
        : undefined;
      if (downloadedImagePath) {
        await fs.unlink(downloadedImagePath).catch(() => undefined);
        logger.system(`Cleaned temporary image ${downloadedImagePath}`);
      }

      logger.debug(`Orchestrator finished task ${task.id}`);
      return {
        taskId: task.id,
        source: task.source,
        agent: subAgent.name,
        response: deliveryResponse,
      };
    } catch (error: any) {
      logger.error(`Queue failed ${task.source}:${task.sourceId} ${task.id}: ${error.message}`);
      return {
        taskId: task.id,
        source: task.source,
        agent: 'System',
        response: ` I encountered an error while processing your request: ${error.message}`,
      };
    }
  }

  async processPrompt(prompt: string, options: { supplementalSystemPrompt?: string; trackProactiveNotifications?: boolean } = {}): Promise<string> {
    const result = await this.processTask({
      id: `legacy-${Date.now()}`,
      source: 'terminal',
      prompt,
      supplementalSystemPrompt: options.supplementalSystemPrompt,
      trackProactiveNotifications: options.trackProactiveNotifications,
    });

    return result.response;
  }

  private async tryFastPath(task: TaskEnvelope): Promise<TaskResult | null> {
    const route = matchFastPath(task.prompt);
    if (!route) {
      return null;
    }

    const { result, statusLine } = await (route as any).handler(task.prompt);
    if (statusLine) {
      logger.status(statusLine);
    }

    const response = typeof result === 'string'
      ? result
      : JSON.stringify(result);

    sessionStore.appendInteraction(task, task.prompt, response);

    logger.chat('assistant', response);

    await vectorStore.store({
      source: `${task.source}:${task.id}`,
      scope: 'chat',
      content: `Prompt: ${task.prompt}\n\nResponse: ${response}`,
      metadata: {
        taskId: task.id,
        source: task.source,
        sourceId: task.sourceId,
        sessionKey: sessionStore.getSessionKey(task),
        sourceKey: sessionStore.getSourceKey(task.source),
        subAgent: 'FastPath',
      },
    });

    return {
      taskId: task.id,
      source: task.source,
      agent: 'FastPath',
      response,
    };
  }

  private async runSubAgent(agent: AgentConfig, task: TaskEnvelope, managerNote: string): Promise<string> {
    const soulContext = await soulStore.loadContextualMemory(task.prompt);

    // Select model tier based on sub-agent name or tools
    let tier: ModelTier = 'fast';
    if (agent.name.toLowerCase().includes('research') || agent.name.toLowerCase().includes('reason')) {
      tier = 'reasoning';
    } else if (agent.tools.includes('vision_get_screen_snapshot') || agent.tools.includes('analyze_image_content')) {
      tier = 'vision';
    } else if (agent.tools.includes('create_new_skill')) {
      tier = 'coding';
    }

    const route = modelRouter.getRoute(tier);
    logger.debug(`[Router] Selected ${route.provider}:${route.model} for sub-agent ${agent.name}`);

    const session = sessionStore.getSession(task);
    const sessionHistory = sessionStore.formatSessionHistory(task, 6);
    const sourceHistory = sessionStore.formatSourceHistory(task.source, 6);
    const memoryContext = memoryStore.formatContext(task.prompt, 5);
    const recentNotifications = memoryStore.formatRecentNotificationContext(5);
    const vectorContext = await vectorStore.searchSimilar(task.prompt, 8);
    const sessionVectorContext = await vectorStore.searchSimilar(task.prompt, 5);
    const sourceVectorContext = await vectorStore.searchSimilar(task.prompt, 5);
    const relevantExperience = await findRelevantExperience(task.prompt);

    const vectorSummary = vectorContext.length > 0
      ? vectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
      : 'No relevant long-term memory found.';

    const sessionVectorSummary = sessionVectorContext.length > 0
      ? sessionVectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
      : 'No prior session context found.';

    const sourceVectorSummary = sourceVectorContext.length > 0
      ? sourceVectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
      : 'No prior source context found.';

    const experienceSummary = relevantExperience.length > 0
      ? `PAST EXPERIENCES AND LEARNINGS:\n${relevantExperience.map((e) => `- Prompt: ${e.task}\n  Error: ${e.error}\n  Lesson: ${e.successPlan}`).join('\n')}`
      : '';

    const messages: Message[] = [
      {
        role: 'system',
        content: `${agent.systemPrompt.trim()}\n\n${AUTONOMOUS_AGENT_SYSTEM_PROMPT}`,
      },
      {
        role: 'system',
        content: `AGENT SOUL AND USER PREFERENCES:\n${soulContext}`,
      },
      {
        role: 'system',
        content: `${MANAGER_SYSTEM_PROMPT}\n\n${managerNote}`,
      },
      {
        role: 'system',
        content: `Recent session history:\n${sessionHistory}`,
      },
      {
        role: 'system',
        content: `Recent source history:\n${sourceHistory}`,
      },
      {
        role: 'system',
        content: `Recent proactive notifications:\n${recentNotifications}`,
      },
      {
        role: 'system',
        content: `Session vector memory:\n${sessionVectorSummary}`,
      },
      {
        role: 'system',
        content: `Source vector memory:\n${sourceVectorSummary}`,
      },
      {
        role: 'system',
        content: `Relevant vector memory:\n${vectorSummary}`,
      },
      {
        role: 'system',
        content: experienceSummary,
      },
    ];

    if (task.supplementalSystemPrompt) {
      messages.push({
        role: 'system',
        content: task.supplementalSystemPrompt,
      });
    }

    if (task.source === 'telegram') {
      messages.push({
        role: 'system',
        content: TELEGRAM_RESPONSE_PROMPT,
      });
    }

    messages.push({ role: 'user', content: task.prompt });

    let awaitingReflection = false;

    for (let step = 1; step <= MAX_REASONING_STEPS; step++) {
      let assistantMessage: Message;

      if (route.provider === 'gemini') {
        const text = await chatWithGemini(messages, route.model);
        assistantMessage = { role: 'assistant', content: cleanModelOutput(text) };
      } else {
        const response = await chatWithFallback(ollamaChatProvider, {
          model: route.model,
          messages: messages,
          tools: toolRegistry.getOllamaToolsDefinition(agent.tools) as any,
        }, config.models.chatFallback);
        assistantMessage = {
          role: response.message.role as any,
          content: cleanModelOutput(response.message.content || ''),
          tool_calls: response.message.tool_calls as any,
        };
      }

      messages.push(assistantMessage);

      if (assistantMessage.content && !awaitingReflection) {
        if (hasThought(assistantMessage.content)) {
          logger.thought(assistantMessage.content);
        } else if (assistantMessage.content.includes('Plan:')) {
          logger.plan(assistantMessage.content);
        } else if (assistantMessage.content.includes('Finished:')) {
          sessionStore.appendInteraction(task, task.prompt, assistantMessage.content);
          return assistantMessage.content;
        } else {
          logger.chat('assistant', assistantMessage.content);
        }
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const tool = toolRegistry.getTool(toolCall.function.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              content: formatToolError(toolCall.function.name, toolCall.function.arguments, 'Tool not found'),
              tool_call_id: toolCall.id,
            });
            continue;
          }

          try {
            const args = JSON.parse(toolCall.function.arguments);
            
            const risk = await assessToolRisk(tool, args, task.source, session.settings);
            if (!risk.allowed) {
              writeSecurityAudit({
                timestamp: new Date().toISOString(),
                type: 'tool_blocked',
                source: task.source,
                actor: task.sourceId || 'unknown',
                toolName: tool.name,
                permissionClass: risk.permissionClass,
                detail: risk.reason,
              });
              throw new Error(risk.reason);
            }

            if (risk.requiresAuthorization) {
              const authorizer = this.authorizers.get(task.source) || this.authorizers.get('default');
              if (!authorizer) {
                throw new Error(`Authorization required for ${tool.name} but no authorizer available for ${task.source}`);
              }

              const approved = await authorizer.requestAuthorization({
                id: `auth-${Date.now()}`,
                source: task.source,
                sourceId: task.sourceId,
                toolName: tool.name,
                command: `${tool.name} ${toolCall.function.arguments}`,
                reason: `Tool ${tool.name} requires ${risk.permissionClass} permission.`,
                permissionClass: risk.permissionClass,
              });

              if (!approved) {
                writeSecurityAudit({
                  timestamp: new Date().toISOString(),
                  type: 'authorization_denied',
                  source: task.source,
                  actor: task.sourceId || 'unknown',
                  toolName: tool.name,
                  permissionClass: risk.permissionClass,
                  detail: 'User denied authorization request.',
                });
                throw new Error('User denied authorization.');
              }

              writeSecurityAudit({
                timestamp: new Date().toISOString(),
                type: 'authorization_approved',
                source: task.source,
                actor: task.sourceId || 'unknown',
                toolName: tool.name,
                permissionClass: risk.permissionClass,
                detail: 'User approved authorization request.',
              });
            }

            logger.debug(`Executing tool ${tool.name} with args: ${toolCall.function.arguments}`);
            const result = await tool.execute(args, { task });
            logger.debug(`Tool ${tool.name} finished.`);
            messages.push({
              role: 'tool',
              content: formatToolResult(tool.name, args, result),
              tool_call_id: toolCall.id,
            });
          } catch (error) {
            const friendlyError = error instanceof ZodError
              ? `Invalid arguments for ${tool.name}: ${formatSchemaValidationError(error)}`
              : getErrorMessage(error);
            logger.error(`Tool ${tool.name} ${getErrorMessage(error)}`);
            await saveExperience(task.prompt, `Tool ${tool.name} failed with error: ${friendlyError}`, `Adjust ${tool.name} arguments based on the error and retry with a narrower, validated plan.`);
            
            const isAppleScriptError = /applescript|spotify|music|finder|system events/i.test(tool.name) || /spotify|music|finder|system events/i.test(friendlyError);
            
            if (isAppleScriptError) {
              logger.system(`🧠 Healing: Attempting AppleScript recovery for ${tool.name}`);
            }

            messages.push({
              role: 'tool',
              content: formatToolError(tool.name, toolCall.function.arguments, friendlyError),
              tool_call_id: toolCall.id,
            });
            messages.push({
              role: 'system',
              content: isAppleScriptError ? APPLESCRIPT_HEALING_PROMPT : TOOL_FAILURE_RECOVERY_PROMPT,
            });
          }
        }

        awaitingReflection = true;
      } else {
        awaitingReflection = false;
      }
    }

    throw new Error(`Autonomous loop exceeded ${MAX_REASONING_STEPS} steps without reaching Finished:`);
  }
}

function writeSecurityAudit(event: any) {
  const auditPath = path.join(process.cwd(), 'data', 'security-audit.jsonl');
  fs.appendFile(auditPath, JSON.stringify(event) + '\n').catch(() => undefined);
}
