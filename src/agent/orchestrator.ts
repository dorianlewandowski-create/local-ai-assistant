import ollama from 'ollama';
import fs from 'fs/promises';
import { AgentConfig, Message, TaskEnvelope, TaskResult, ToolCall } from '../types';
import { toolRegistry } from '../tools/registry';
import { memoryStore } from '../db/memory';
import { vectorStore } from '../db/vectorStore';
import { AgentFactory } from './factory';
import { GatewayResponder } from '../gateways/base';
import { logger } from '../utils/logger';

const AUTONOMOUS_AGENT_SYSTEM_PROMPT = `You are OpenMac, an elite autonomous agent for macOS. You are precise, helpful, and sophisticated. Use the  OpenMac signature in final responses.

Operate as an autonomous agent using a Plan-Act-Observe loop.
For every non-trivial task, think in short explicit sections inside your assistant message:
Thought: what you believe is happening.
Plan: the next concrete step.
Reflection: after every tool result, evaluate whether the result is correct, what changed, and whether another action is needed.
Finished: only when the task is fully complete. Always include a line starting with Finished: when you are done.

Before calling any tool, include Thought: and Plan: in the same assistant message.
After tool results arrive, include Reflection: before choosing another action or finishing.
Continue the loop automatically until you can confidently write Finished:.

Use long-term memory proactively:
- Call recall_facts when user context, preferences, pets, projects, routines, or prior facts may matter.
- Call search_vector_memory when semantic recall of prior files, chats, or stored knowledge may help you understand the current task.
- Call save_fact when you learn a stable fact that will help future assistance.

If a file event occurs and you do not know the file contents yet, use the appropriate read_text_file, read_pdf_content, or analyze_image_content tool before making a decision or saving a fact.
After performing an autonomous action triggered by a file event, always use send_system_notification to inform the user what you did.

If a tool fails, do not give up or ask the user to do it manually right away.
Analyze the tool error, correct the parameters, and try again.
Only ask the user for clarification if the missing information cannot be inferred.`;

const MANAGER_SYSTEM_PROMPT = `You are the Manager agent.
Your job is to inspect the task, choose the best sub-agent, and supervise execution.
Available sub-agents:
- Researcher Agent: investigations, reading, synthesis, context gathering.
- Coder Agent: code changes, filesystem edits, debugging, implementation.
- System Agent: operating system actions, notifications, scheduling, monitoring.

Always produce a concise delegation record with:
Thought:
Plan:
Finished:
State which sub-agent you selected and why.`;

const TOOL_FAILURE_RECOVERY_PROMPT = 'The previous tool call failed. Analyze the error, correct your parameters, and try again.';
const CONTINUE_AUTONOMOUS_LOOP_PROMPT = 'Continue the Plan-Act-Observe loop. Provide Reflection: and either make another tool call or end with Finished:.';
const TELEGRAM_RESPONSE_PROMPT = 'This task came from Telegram. Your final user-facing result must be optimized for a mobile screen: elite, short, clear, actionable, and easy to scan. Use light emojis for readability. End with a subtle  OpenMac signature. Put the user-facing message on the Finished: line using Markdown-friendly formatting.';
const MAX_REASONING_STEPS = 24;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : JSON.stringify(error);
}

function formatToolError(toolName: string, args: unknown, error: unknown): string {
  return JSON.stringify({
    success: false,
    tool: toolName,
    args,
    error: getErrorMessage(error),
  });
}

function hasFinished(content: string): boolean {
  return /(^|\n)Finished\s*:/i.test(content);
}

function extractFinishedContent(content: string): string {
  const match = content.match(/(^|\n)Finished\s*:\s*([\s\S]*)$/i);
  return match?.[2]?.trim() || content.trim();
}

function hasThought(content: string): boolean {
  return /(^|\n)Thought\s*:/i.test(content);
}

function hasPlan(content: string): boolean {
  return /(^|\n)Plan\s*:/i.test(content);
}

function hasReflection(content: string): boolean {
  return /(^|\n)Reflection\s*:/i.test(content);
}

function logMonologue(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  for (const line of trimmed.split('\n')) {
    if (/^Thought\s*:/i.test(line)) {
      logger.thought(line.replace(/^Thought\s*:/i, '').trim());
    } else if (/^Plan\s*:/i.test(line)) {
      logger.plan(line.replace(/^Plan\s*:/i, '').trim());
    } else if (/^Reflection\s*:/i.test(line)) {
      logger.reflection(line.replace(/^Reflection\s*:/i, '').trim());
    } else if (/^Finished\s*:/i.test(line)) {
      logger.system(`Finished ${line.replace(/^Finished\s*:/i, '').trim()}`);
    } else {
      logger.system(line);
    }
  }
}

export class Orchestrator {
  private readonly activeAgent: AgentConfig;
  private readonly factory: AgentFactory;
  private readonly gateways = new Map<string, GatewayResponder>();

  constructor(agent: AgentConfig) {
    this.activeAgent = agent;
    this.factory = new AgentFactory(agent.model, agent.tools);
  }

  registerGateway(source: 'whatsapp' | 'telegram' | 'slack', gateway: GatewayResponder) {
    this.gateways.set(source, gateway);
  }

  async processTask(task: TaskEnvelope): Promise<TaskResult> {
    const subAgentKind = this.factory.choose(task.prompt, task.metadata);
    const subAgent = this.factory.create(subAgentKind);

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
        subAgent: subAgent.name,
      },
    });

      if ((task.source === 'whatsapp' || task.source === 'telegram' || task.source === 'slack') && task.sourceId) {
        const gateway = this.gateways.get(task.source);
        if (gateway) {
          await gateway.sendResponse(task.sourceId, deliveryResponse);
          logger.chat('assistant', `[${task.source}] ${deliveryResponse}`);
        } else {
          logger.error(`No gateway registered for ${task.source}, unable to send response`);
        }
      }

    const downloadedImagePath = typeof task.metadata?.downloadedImagePath === 'string'
      ? task.metadata.downloadedImagePath
      : undefined;
    if (downloadedImagePath) {
      await fs.unlink(downloadedImagePath).catch(() => undefined);
      logger.system(`Cleaned temporary image ${downloadedImagePath}`);
    }

    return {
      taskId: task.id,
      source: task.source,
      agent: subAgent.name,
      response: deliveryResponse,
    };
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

  private async runSubAgent(agent: AgentConfig, task: TaskEnvelope, managerNote: string): Promise<string> {
    const memoryContext = memoryStore.formatContext(task.prompt, 5);
    const recentNotifications = memoryStore.formatRecentNotificationContext(5);
    const vectorContext = await vectorStore.searchSimilar(task.prompt, 3);
    const vectorSummary = vectorContext.length === 0
      ? 'No related vector memory matches found.'
      : vectorContext.map((item) => `- [${item.scope}] ${item.content}`).join('\n');

    const messages: Message[] = [
      {
        role: 'system',
        content: `${agent.systemPrompt.trim()}\n\n${AUTONOMOUS_AGENT_SYSTEM_PROMPT}`,
      },
      {
        role: 'system',
        content: `${MANAGER_SYSTEM_PROMPT}\n\n${managerNote}`,
      },
      {
        role: 'system',
        content: `Relevant long-term memory:\n${memoryContext}`,
      },
      {
        role: 'system',
        content: `Recent proactive notifications:\n${recentNotifications}`,
      },
      {
        role: 'system',
        content: `Relevant vector memory:\n${vectorSummary}`,
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
      const response = await ollama.chat({
        model: agent.model,
        messages: messages as any,
        tools: toolRegistry.getOllamaToolsDefinition(agent.tools) as any,
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message.content,
        tool_calls: response.message.tool_calls as unknown as ToolCall[],
      };

      messages.push(assistantMessage);
      logMonologue(assistantMessage.content);

      if (awaitingReflection && !hasReflection(assistantMessage.content)) {
        messages.push({
          role: 'system',
          content: 'You must include Reflection: after tool results before taking the next action or finishing.',
        });
        continue;
      }

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        if (hasFinished(assistantMessage.content)) {
          return assistantMessage.content;
        }

        awaitingReflection = false;
        messages.push({
          role: 'system',
          content: CONTINUE_AUTONOMOUS_LOOP_PROMPT,
        });
        continue;
      }

      if (!hasThought(assistantMessage.content) || !hasPlan(assistantMessage.content)) {
        messages.push({
          role: 'system',
          content: 'Before calling any tool, you must include both Thought: and Plan: in your assistant message.',
        });
        continue;
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const tool = toolRegistry.getTool(toolCall.function.name);

        if (!tool) {
          logger.error(`Tool ${toolCall.function.name} not found`);
          messages.push({
            role: 'tool',
            content: formatToolError(toolCall.function.name, toolCall.function.arguments, `Tool ${toolCall.function.name} not found.`),
            tool_call_id: toolCall.id,
          });
          messages.push({
            role: 'system',
            content: TOOL_FAILURE_RECOVERY_PROMPT,
          });
          continue;
        }

        try {
          const rawArgs = toolCall.function.arguments;
          const parsedArgs = typeof rawArgs === 'string'
            ? (rawArgs.trim() ? JSON.parse(rawArgs) : {})
            : (rawArgs ?? {});
          const validatedArgs = tool.parameters.parse(parsedArgs);

          logger.tool(`Call ${tool.name} ${JSON.stringify(validatedArgs)}`);

          if (task.trackProactiveNotifications && tool.name === 'send_system_notification') {
            const message = typeof validatedArgs.message === 'string' ? validatedArgs.message.trim() : '';
            if (!message) {
              throw new Error('send_system_notification requires a non-empty message.');
            }

            if (memoryStore.wasRecentlyNotified(message, 12)) {
              throw new Error(`A similar proactive notification was already sent recently: ${message}`);
            }
          }

          const result = await tool.execute(validatedArgs);
          if (result && typeof result === 'object' && 'success' in result && result.success === false) {
            throw new Error(typeof result.error === 'string' ? result.error : `Tool ${tool.name} reported a failure.`);
          }

          if (task.trackProactiveNotifications && tool.name === 'send_system_notification') {
            const message = typeof validatedArgs.message === 'string' ? validatedArgs.message.trim() : '';
            if (message) {
              memoryStore.recordNotification(message, 'proactive_alert', 'proactive_review', 1);
            }
          }

          logger.toolResult(`Result ${tool.name} ${JSON.stringify(result)}`);
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
          });
        } catch (error) {
          logger.error(`Tool ${tool.name} ${getErrorMessage(error)}`);
          messages.push({
            role: 'tool',
            content: formatToolError(tool.name, toolCall.function.arguments, error),
            tool_call_id: toolCall.id,
          });
          messages.push({
            role: 'system',
            content: TOOL_FAILURE_RECOVERY_PROMPT,
          });
        }
      }

      awaitingReflection = true;
    }

    throw new Error(`Autonomous loop exceeded ${MAX_REASONING_STEPS} steps without reaching Finished:`);
  }
}
