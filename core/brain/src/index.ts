import fs from 'node:fs/promises'
import path from 'node:path'
import { ZodError } from 'zod'
import type { AgentConfig, Message, TaskEnvelope, TaskResult, ToolCall, ToolResult } from '@apex/types'
import { config } from './config'
import { emitApexTrace, resolveTraceId } from './observability'

export interface CoreLogger {
  debug(message: string): void
  system(message: string): void
  status(message: string): void
  chat(role: 'user' | 'assistant', message: string): void
  thought(message: string): void
  plan(message: string): void
  error(message: string): void
}

export interface CoreTool<TArgs = any> {
  name: string
  parameters?: any
  execute(args: TArgs, context?: { task: TaskEnvelope }): Promise<any>
}

export interface ToolRegistryLike {
  getOllamaToolsDefinition(toolNames: string[]): unknown
  getTool(name: string): CoreTool | undefined
}

export interface AuthorizationRequesterLike {
  requestAuthorization(req: {
    id: string
    source: TaskEnvelope['source']
    sourceId?: string
    toolName: string
    command: string
    reason: string
    permissionClass: string
    expiresAt?: string
  }): Promise<boolean>
}

export type ModelTier = 'fast' | 'reasoning' | 'vision' | 'coding' | 'default'
export interface ModelRouterLike {
  getRoute(tier: ModelTier): { model: string; baseUrl?: string; provider?: 'gemini' | 'local' }
  resolveExecutionTier?(prompt: string, agentTier: ModelTier): ModelTier
}

export interface BrainClientLike {
  query(
    prompt: string,
    context: {
      messages: Message[]
      model: string
      tools?: unknown
      baseUrl?: string
      executionProvider?: 'gemini' | 'local'
      /** Carried from {@link TaskEnvelope.metadata} (e.g. correlationId for tracing). */
      metadata?: Record<string, unknown>
    },
  ): Promise<{ text?: string; toolCalls?: ToolCall[] }>
}

export interface SessionStoreLike {
  getSession(task: TaskEnvelope): { settings: { model?: string } }
  getSessionKey(task: TaskEnvelope): string
  getSourceKey(source: TaskEnvelope['source']): string
  formatSessionHistory(task: TaskEnvelope, limit: number): string
  formatSourceHistory(source: TaskEnvelope['source'], limit: number): string
  appendInteraction(task: TaskEnvelope, prompt: string, response: string): Promise<void>
}

export interface FactMemoryLike {
  formatContext(query: string, limit: number): string
  formatRecentNotificationContext(limit: number): string
}

export interface VectorMemoryLike {
  store(input: {
    source: string
    scope: 'chat'
    content: string
    metadata?: Record<string, unknown>
  }): Promise<void>
  searchSimilar(
    query: string,
    limit: number,
  ): Promise<Array<{ content: string; metadata: Record<string, any> }>>
}

export interface SoulMemoryLike {
  loadContextualMemory(context?: string): Promise<string>
}

export interface ExperienceLike {
  findRelevantExperience(
    prompt: string,
    limit?: number,
  ): Promise<Array<{ task: string; error: string; successPlan: string }>>
  saveExperience(task: string, error: string, successPlan: string): Promise<void>
}

export interface RiskAssessmentLike {
  assessToolRisk(
    tool: CoreTool,
    args: any,
    source: TaskEnvelope['source'],
    sessionSettings: any,
  ): Promise<{
    allowed: boolean
    reason: string
    permissionClass: string
    requiresAuthorization: boolean
  }>
}

/** Optional diagnostics from {@link AgentFactoryLike.chooseWithDiagnostics} (app-layer routing). */
export interface SubAgentRoutingInfo {
  kind: string
  source: 'override' | 'heuristic'
  coderScore: number
  researcherScore: number
  confidence: 'high' | 'medium' | 'low'
}

export interface AgentFactoryLike {
  choose(prompt: string, metadata: any): string
  create(kind: string): AgentConfig
  /** When provided, used for structured routing logs; must agree with {@link choose}. */
  chooseWithDiagnostics?(prompt: string, metadata: any): SubAgentRoutingInfo
}

export interface CoreDeps {
  logger: CoreLogger
  toolRegistry: ToolRegistryLike
  sessionStore: SessionStoreLike
  modelRouter: ModelRouterLike
  brainClient: BrainClientLike
  factMemory: FactMemoryLike
  vectorMemory: VectorMemoryLike
  soulMemory: SoulMemoryLike
  experience: ExperienceLike
  risk: RiskAssessmentLike
  agentFactory: AgentFactoryLike
}

const AUTONOMOUS_AGENT_SYSTEM_PROMPT = `You are Apex, a high-performance, native macOS intelligence layer. You are precise, helpful, and sophisticated. Use the Apex signature in final responses.

### 🧠 SELF-IMPROVING RULES:
1. **Learn from Corrections:** If the user says "No, do X instead" or "Actually...", you MUST call \`log_correction\` immediately.
2. **Self-Reflection:** After every complex task, call \`log_reflection\` to capture what went well and what could be better.
3. **Compound Knowledge:** Check your WARM memory for context-specific patterns before acting.
4. **The 3x Rule:** If you use a pattern 3 times successfully, propose adding it to your HOT memory via \`update_soul\`.
`

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
`

const TELEGRAM_RESPONSE_PROMPT = `Format your response for Telegram using MarkdownV2. Use bold for key information and code blocks for logs. Use emojis for readability. End with a subtle Apex signature. Put the user-facing message on the Finished: line using Markdown-friendly formatting.`

const TOOL_FAILURE_RECOVERY_PROMPT =
  'The previous tool call failed. Analyze the error, correct your parameters, and try again.'
const APPLESCRIPT_HEALING_PROMPT =
  'The previous AppleScript call failed. This usually means the application dictionary or syntax has changed. Search the web for the latest AppleScript syntax for this application or use the dictionary tool if available, then fix the script and retry.'

const MAX_REASONING_STEPS = 24

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cleanModelOutput(content: string): string {
  return content
    .replace(/<channel▷/g, '')
    .replace(/<\\|[\\s\\S]*?\\|>/g, '')
    .trim()
}

function extractFinishedContent(content: string): string {
  const cleaned = cleanModelOutput(content)
  const match = cleaned.match(/(^|\\n)Finished\\s*:\\s*([\\s\\S]*)$/i)
  return match?.[2]?.trim() || cleaned.trim()
}

function hasThought(content: string): boolean {
  return /(^|\\n)Thought\\s*:/i.test(content)
}

function formatSchemaValidationError(error: ZodError): string {
  return error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
}

function formatToolError(name: string, args: string, error: string): string {
  return `Tool ${name} failed with arguments ${args}. Error: ${error}`
}

function formatToolResult(name: string, args: any, result: ToolResult | any): string {
  const data = result?.success ? result.result || result.data : result?.error || result?.message
  return `Tool ${name} finished. Result: ${typeof data === 'string' ? data : JSON.stringify(data)}`
}

function matchFastPath(_prompt: string): null {
  return null
}

export class ApexCoreOrchestrator {
  private readonly activeAgent: AgentConfig
  private readonly deps: CoreDeps
  private readonly authorizers = new Map<string, AuthorizationRequesterLike>()

  constructor(agent: AgentConfig, deps: CoreDeps) {
    this.activeAgent = agent
    this.deps = deps
  }

  registerAuthorizer(source: string, authorizer: AuthorizationRequesterLike) {
    this.authorizers.set(source, authorizer)
  }

  async processTask(task: TaskEnvelope): Promise<TaskResult> {
    const traceId = resolveTraceId(task)
    const taskStarted = Date.now()
    emitApexTrace('task_start', {
      traceId,
      taskId: task.id,
      source: task.source,
      sourceId: task.sourceId ?? null,
    })

    try {
      const { logger } = this.deps
      logger.debug(`Orchestrator starting task ${task.id}`)

      const fastPath = await this.tryFastPath(task)
      if (fastPath) {
        emitApexTrace('task_end', {
          traceId,
          taskId: task.id,
          durationMs: Date.now() - taskStarted,
          outcome: 'ok',
          path: 'fast_path',
          agent: fastPath.agent,
        })
        return fastPath
      }

      const routing = this.deps.agentFactory.chooseWithDiagnostics?.(task.prompt, task.metadata)
      const subAgentKind = routing?.kind ?? this.deps.agentFactory.choose(task.prompt, task.metadata)
      if (routing) {
        logger.debug(
          `[Routing] task=${task.id} kind=${routing.kind} source=${routing.source} coder=${routing.coderScore} researcher=${routing.researcherScore} confidence=${routing.confidence}`,
        )
      }
      emitApexTrace('routing', {
        traceId,
        taskId: task.id,
        subAgentKind,
        routingSource: routing?.source ?? 'heuristic',
        coderScore: routing?.coderScore,
        researcherScore: routing?.researcherScore,
        confidence: routing?.confidence,
      })
      const subAgent = this.deps.agentFactory.create(subAgentKind)
      const sessionModel = this.deps.sessionStore.getSession(task).settings.model
      if (sessionModel) {
        subAgent.model = sessionModel
      }

      logger.system(`Manager delegating ${task.id} from ${task.source} to ${subAgent.name}`)
      const managerNote = `Task source: ${task.source}. Selected sub-agent: ${subAgent.name}. Reason: ${subAgentKind} is the best fit for this task.`

      const response = await this.runSubAgent(subAgent, task, managerNote, subAgentKind)
      const deliveryResponse = task.source === 'telegram' ? extractFinishedContent(response) : response

      await this.deps.vectorMemory.store({
        source: `${task.source}:${task.id}`,
        scope: 'chat',
        content: `Prompt: ${task.prompt}\n\nResponse: ${deliveryResponse}`,
        metadata: {
          taskId: task.id,
          source: task.source,
          sourceId: task.sourceId,
          sessionKey: this.deps.sessionStore.getSessionKey(task),
          sourceKey: this.deps.sessionStore.getSourceKey(task.source),
          subAgent: subAgent.name,
        },
      })

      const downloadedImagePath =
        typeof task.metadata?.downloadedImagePath === 'string' ? task.metadata.downloadedImagePath : undefined
      if (downloadedImagePath) {
        await fs.unlink(downloadedImagePath).catch(() => undefined)
        logger.system(`Cleaned temporary image ${downloadedImagePath}`)
      }

      logger.debug(`Orchestrator finished task ${task.id}`)
      emitApexTrace('task_end', {
        traceId,
        taskId: task.id,
        durationMs: Date.now() - taskStarted,
        outcome: 'ok',
        path: 'orchestrator',
        agent: subAgent.name,
        subAgentKind,
      })
      return {
        taskId: task.id,
        source: task.source,
        agent: subAgent.name,
        response: deliveryResponse,
      }
    } catch (error: any) {
      emitApexTrace('task_end', {
        traceId,
        taskId: task.id,
        durationMs: Date.now() - taskStarted,
        outcome: 'error',
        error: String(error?.message ?? error ?? 'unknown'),
      })
      this.deps.logger.error(`Queue failed ${task.source}:${task.sourceId} ${task.id}: ${error.message}`)
      return {
        taskId: task.id,
        source: task.source,
        agent: 'System',
        response: ` I encountered an error while processing your request: ${error.message}`,
      }
    }
  }

  async processPrompt(
    prompt: string,
    options: { supplementalSystemPrompt?: string; trackProactiveNotifications?: boolean } = {},
  ): Promise<string> {
    const result = await this.processTask({
      id: `legacy-${Date.now()}`,
      source: 'terminal',
      prompt,
      supplementalSystemPrompt: options.supplementalSystemPrompt,
      trackProactiveNotifications: options.trackProactiveNotifications,
    })
    return result.response
  }

  private async tryFastPath(task: TaskEnvelope): Promise<TaskResult | null> {
    const route = matchFastPath(task.prompt)
    if (!route) return null
    const { result, statusLine } = await (route as any).handler(task.prompt)
    if (statusLine) this.deps.logger.status(statusLine)
    const response = typeof result === 'string' ? result : JSON.stringify(result)
    await this.deps.sessionStore.appendInteraction(task, task.prompt, response)
    this.deps.logger.chat('assistant', response)
    await this.deps.vectorMemory.store({
      source: `${task.source}:${task.id}`,
      scope: 'chat',
      content: `Prompt: ${task.prompt}\n\nResponse: ${response}`,
      metadata: {
        taskId: task.id,
        source: task.source,
        sourceId: task.sourceId,
        sessionKey: this.deps.sessionStore.getSessionKey(task),
        sourceKey: this.deps.sessionStore.getSourceKey(task.source),
        subAgent: 'FastPath',
      },
    })
    return { taskId: task.id, source: task.source, agent: 'FastPath', response }
  }

  private async runSubAgent(
    agent: AgentConfig,
    task: TaskEnvelope,
    managerNote: string,
    subAgentKind: string,
  ): Promise<string> {
    const { logger } = this.deps
    const traceId = resolveTraceId(task)
    const soulContext = await this.deps.soulMemory.loadContextualMemory(task.prompt)

    let tier: ModelTier = 'fast'
    if (agent.name.toLowerCase().includes('research') || agent.name.toLowerCase().includes('reason')) {
      tier = 'reasoning'
    } else if (agent.tools.includes('create_new_skill')) {
      tier = 'coding'
    }
    // Intentionally do NOT set tier from vision_* tools here: the default System agent includes
    // screen/vision tools, and that forced tier='vision' for every prompt — routing all chat to the
    // heavy multimodal model. Vision tier is chosen from the user prompt via resolveExecutionTier.

    tier = this.deps.modelRouter.resolveExecutionTier?.(task.prompt, tier) ?? tier

    const route = this.deps.modelRouter.getRoute(tier)
    let executionProvider: 'gemini' | 'local' =
      (route as { provider?: 'gemini' | 'local' }).provider === 'gemini' ? 'gemini' : 'local'

    // Runtime clients (CLI, tests) may set task.metadata.executionProvider. The tier-based route
    // alone can still be local (e.g. fast tier → Ollama) even when the user forced cloud.
    let effectiveRoute: ReturnType<ModelRouterLike['getRoute']> = route
    const forced = task.metadata?.executionProvider as 'gemini' | 'local' | undefined
    if (forced === 'gemini') {
      executionProvider = 'gemini'
      const reasoningRoute = this.deps.modelRouter.getRoute('reasoning')
      if ((reasoningRoute as { provider?: 'gemini' | 'local' }).provider === 'gemini') {
        effectiveRoute = reasoningRoute
      } else {
        effectiveRoute = {
          ...reasoningRoute,
          provider: 'gemini',
          model:
            (config as { models?: { geminiModel?: string } }).models?.geminiModel || 'gemini-3.1-pro-preview',
          apiKey: (config as { apiKeys?: { gemini?: string } }).apiKeys?.gemini,
        } as typeof route
      }
    } else if (forced === 'local') {
      executionProvider = 'local'
      const fastRoute = this.deps.modelRouter.getRoute('fast')
      if ((fastRoute as { provider?: 'gemini' | 'local' }).provider === 'local') {
        effectiveRoute = fastRoute
      } else {
        effectiveRoute = {
          provider: 'local',
          model:
            (config as { models?: { tiers?: { fast?: string }; chat?: string } }).models?.tiers?.fast ||
            (config as { models?: { chat?: string } }).models?.chat ||
            'llama3.1',
          baseUrl: (config as { ollama?: { host?: string } }).ollama?.host,
        } as typeof route
      }
    }

    const session = this.deps.sessionStore.getSession(task)
    const sessionHistory = this.deps.sessionStore.formatSessionHistory(task, 6)
    const sourceHistory = this.deps.sessionStore.formatSourceHistory(task.source, 6)
    const recentNotifications = this.deps.factMemory.formatRecentNotificationContext(5)

    // Run in parallel so a slow/offline Ollama embed does not triple the time before the LLM call.
    const [vectorContext, sessionVectorContext, sourceVectorContext] = await Promise.all([
      this.deps.vectorMemory.searchSimilar(task.prompt, 8),
      this.deps.vectorMemory.searchSimilar(task.prompt, 5),
      this.deps.vectorMemory.searchSimilar(task.prompt, 5),
    ])

    const relevantExperience = await this.deps.experience.findRelevantExperience(task.prompt)

    const vectorSummary =
      vectorContext.length > 0
        ? vectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
        : 'No relevant long-term memory found.'

    const sessionVectorSummary =
      sessionVectorContext.length > 0
        ? sessionVectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
        : 'No prior session context found.'

    const sourceVectorSummary =
      sourceVectorContext.length > 0
        ? sourceVectorContext.map((v) => `[${v.metadata.scope}] ${v.content}`).join('\n---\n')
        : 'No prior source context found.'

    const experienceSummary =
      relevantExperience.length > 0
        ? `PAST EXPERIENCES AND LEARNINGS:\n${relevantExperience.map((e) => `- Prompt: ${e.task}\n  Error: ${e.error}\n  Lesson: ${e.successPlan}`).join('\n')}`
        : ''

    const messages: Message[] = [
      { role: 'system', content: `${agent.systemPrompt.trim()}\n\n${AUTONOMOUS_AGENT_SYSTEM_PROMPT}` },
      { role: 'system', content: `AGENT SOUL AND USER PREFERENCES:\n${soulContext}` },
      { role: 'system', content: `${MANAGER_SYSTEM_PROMPT}\n\n${managerNote}` },
      { role: 'system', content: `Recent session history:\n${sessionHistory}` },
      { role: 'system', content: `Recent source history:\n${sourceHistory}` },
      { role: 'system', content: `Recent proactive notifications:\n${recentNotifications}` },
      { role: 'system', content: `Session vector memory:\n${sessionVectorSummary}` },
      { role: 'system', content: `Source vector memory:\n${sourceVectorSummary}` },
      { role: 'system', content: `Relevant vector memory:\n${vectorSummary}` },
      { role: 'system', content: experienceSummary },
    ]

    if (task.supplementalSystemPrompt)
      messages.push({ role: 'system', content: task.supplementalSystemPrompt })
    if (task.source === 'telegram') messages.push({ role: 'system', content: TELEGRAM_RESPONSE_PROMPT })
    messages.push({ role: 'user', content: task.prompt })

    let awaitingReflection = false

    for (let step = 1; step <= MAX_REASONING_STEPS; step++) {
      const tools = this.deps.toolRegistry.getOllamaToolsDefinition(agent.tools)
      const llmStarted = Date.now()
      const resp = await this.deps.brainClient.query('', {
        messages,
        model: (effectiveRoute as { model: string }).model,
        tools,
        baseUrl: (effectiveRoute as { baseUrl?: string }).baseUrl,
        executionProvider,
        metadata: task.metadata,
      })
      emitApexTrace('llm_roundtrip', {
        traceId,
        taskId: task.id,
        subAgentKind,
        step,
        durationMs: Date.now() - llmStarted,
        model: (effectiveRoute as { model: string }).model,
        executionProvider,
        toolCallCount: Array.isArray(resp.toolCalls) ? resp.toolCalls.length : 0,
      })
      const assistantMessage: Message = {
        role: 'assistant',
        content: cleanModelOutput(resp.text || ''),
        tool_calls: resp.toolCalls as any,
      }
      messages.push(assistantMessage)

      if (assistantMessage.content && !awaitingReflection) {
        if (hasThought(assistantMessage.content)) {
          logger.thought(assistantMessage.content)
        } else if (assistantMessage.content.includes('Plan:')) {
          logger.plan(assistantMessage.content)
        } else if (assistantMessage.content.includes('Finished:')) {
          await this.deps.sessionStore.appendInteraction(task, task.prompt, assistantMessage.content)
          return assistantMessage.content
        } else {
          logger.chat('assistant', assistantMessage.content)
        }
      }

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const tool = this.deps.toolRegistry.getTool(toolCall.function.name)
          if (!tool) {
            emitApexTrace('tool_execute', {
              traceId,
              taskId: task.id,
              subAgentKind,
              tool: toolCall.function.name,
              success: false,
              error: 'tool_not_found',
            })
            messages.push({
              role: 'tool',
              content: formatToolError(toolCall.function.name, toolCall.function.arguments, 'Tool not found'),
              tool_call_id: toolCall.id,
            })
            continue
          }

          try {
            const args = JSON.parse(toolCall.function.arguments)
            const risk = await this.deps.risk.assessToolRisk(tool, args, task.source, session.settings)
            if (!risk.allowed) {
              emitApexTrace('tool_blocked', {
                traceId,
                taskId: task.id,
                subAgentKind,
                tool: tool.name,
                permissionClass: risk.permissionClass,
                reason: risk.reason,
              })
              writeSecurityAudit({
                timestamp: new Date().toISOString(),
                type: 'tool_blocked',
                source: task.source,
                actor: task.sourceId || 'unknown',
                toolName: tool.name,
                permissionClass: risk.permissionClass,
                detail: risk.reason,
              })
              throw new Error(risk.reason)
            }

            if (risk.requiresAuthorization) {
              const authorizer = this.authorizers.get(task.source) || this.authorizers.get('default')
              if (!authorizer) {
                throw new Error(
                  `Authorization required for ${tool.name} but no authorizer available for ${task.source}`,
                )
              }

              const approved = await authorizer.requestAuthorization({
                id: `auth-${Date.now()}`,
                source: task.source,
                sourceId: task.sourceId,
                toolName: tool.name,
                command: `${tool.name} ${toolCall.function.arguments}`,
                reason: `Tool ${tool.name} requires ${risk.permissionClass} permission.`,
                permissionClass: risk.permissionClass,
              })

              if (!approved) {
                emitApexTrace('tool_auth_denied', {
                  traceId,
                  taskId: task.id,
                  subAgentKind,
                  tool: tool.name,
                  permissionClass: risk.permissionClass,
                })
                writeSecurityAudit({
                  timestamp: new Date().toISOString(),
                  type: 'authorization_denied',
                  source: task.source,
                  actor: task.sourceId || 'unknown',
                  toolName: tool.name,
                  permissionClass: risk.permissionClass,
                  detail: 'User denied authorization request.',
                })
                throw new Error('User denied authorization.')
              }

              writeSecurityAudit({
                timestamp: new Date().toISOString(),
                type: 'authorization_approved',
                source: task.source,
                actor: task.sourceId || 'unknown',
                toolName: tool.name,
                permissionClass: risk.permissionClass,
                detail: 'User approved authorization request.',
              })
            }

            logger.debug(`Executing tool ${tool.name} with args: ${toolCall.function.arguments}`)
            const toolStarted = Date.now()
            const result = await tool.execute(args, { task })
            logger.debug(`Tool ${tool.name} finished.`)
            const toolDurationMs = Date.now() - toolStarted
            const toolOk =
              result && typeof result === 'object' && result !== null && 'success' in (result as object)
                ? Boolean((result as { success?: boolean }).success)
                : true
            emitApexTrace('tool_execute', {
              traceId,
              taskId: task.id,
              subAgentKind,
              step,
              tool: tool.name,
              durationMs: toolDurationMs,
              success: toolOk,
            })

            messages.push({
              role: 'tool',
              content: formatToolResult(tool.name, args, result),
              tool_call_id: toolCall.id,
            })
          } catch (error) {
            const friendlyError =
              error instanceof ZodError
                ? `Invalid arguments for ${tool.name}: ${formatSchemaValidationError(error)}`
                : getErrorMessage(error)
            emitApexTrace('tool_error', {
              traceId,
              taskId: task.id,
              subAgentKind,
              step,
              tool: tool.name,
              error: friendlyError,
            })
            logger.error(`Tool ${tool.name} ${getErrorMessage(error)}`)
            await this.deps.experience.saveExperience(
              task.prompt,
              `Tool ${tool.name} failed with error: ${friendlyError}`,
              `Adjust ${tool.name} arguments based on the error and retry with a narrower, validated plan.`,
            )

            const isAppleScriptError =
              /applescript|spotify|music|finder|system events/i.test(tool.name) ||
              /spotify|music|finder|system events/i.test(friendlyError)
            if (isAppleScriptError)
              logger.system(`🧠 Healing: Attempting AppleScript recovery for ${tool.name}`)

            messages.push({
              role: 'tool',
              content: formatToolError(tool.name, toolCall.function.arguments, friendlyError),
              tool_call_id: toolCall.id,
            })
            messages.push({
              role: 'system',
              content: isAppleScriptError ? APPLESCRIPT_HEALING_PROMPT : TOOL_FAILURE_RECOVERY_PROMPT,
            })
          }
        }
        awaitingReflection = true
      } else {
        awaitingReflection = false
      }
    }

    throw new Error(`Autonomous loop exceeded ${MAX_REASONING_STEPS} steps without reaching Finished:`)
  }
}

function writeSecurityAudit(event: any) {
  const auditPath = path.join(process.cwd(), 'data', 'security-audit.jsonl')
  fs.appendFile(auditPath, JSON.stringify(event) + '\n').catch(() => undefined)
}

// Runtime entrypoint exports.
// `@apex/core` is required at runtime by gateways and the monolith, so we must
// re-export config/security/media from here (not types-only `public.ts`).
export * from './config'
export * from './security'
export * from './media'
export { apexTraceEnabled, emitApexTrace, resolveTraceId } from './observability'
