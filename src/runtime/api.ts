import { config } from '@apex/core'
import { resolveApexInstallRoot } from './installRoot'
import { TaskQueue, TaskQueueSnapshot } from './taskQueue'
import { RuntimeServices } from './services'
import { PendingApprovalCounter } from './appContext'
import type { SubAgentKind, TaskEnvelope } from '@apex/types'
import { logger, LogListener } from '../utils/logger'
import { activeModelState } from './activeModelState'

export interface RuntimeStatusSnapshot {
  health: {
    version: string
    ollamaHost: string
    remoteSafeMode: boolean
    pendingApprovals: number
  }
  settings: {
    activeBrain: 'local' | 'gemini'
    routerMode: 'always_gemini' | 'always_local' | 'smart'
    privacyMode: boolean
  }
  activeModel: import('./activeModelState').ActiveModelState | null
  queue: TaskQueueSnapshot
  sessions: {
    count: number
    recent: ReturnType<RuntimeServices['listSessions']>
  }
  memory: {
    facts: number
    vectors: number
  }
  audit: Awaited<ReturnType<RuntimeServices['readRecentAudit']>>
  /** Process-local install root (daemon process); compare to CLI for upgrade drift. */
  install: {
    apexInstallRoot: string
    apexInstallRootEnv: string | null
  }
}

export interface RuntimePromptSubmission {
  source: TaskEnvelope['source']
  sourceId: string
  prompt: string
  metadata?: Record<string, any>
}

export interface RuntimeApprovalSummary {
  id: string
  source: string
  sourceId: string
  toolName: string
  permissionClass: string
  command: string
  reason: string
  expiresAt: string
}

export interface RuntimeApi {
  getStatusSnapshot(): Promise<RuntimeStatusSnapshot>
  submitPrompt(input: RuntimePromptSubmission): Promise<string>
  setAdminCommandHandler(handler: (task: TaskEnvelope, input: string) => Promise<string | null>): void
  onLog(listener: LogListener): void
  offLog(listener: LogListener): void
  listSessions(limit?: number): ReturnType<RuntimeServices['listSessions']>
  listPendingApprovals(): RuntimeApprovalSummary[]
  settleApproval(id: string, approved: boolean): boolean
  getSessionModel(task: TaskEnvelope): string | undefined
  setSessionModel(task: TaskEnvelope, model: string): void
  getSessionSandboxMode(task: TaskEnvelope): 'default' | 'strict' | 'off' | undefined
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off'): void
  getSessionSubAgentKind(task: TaskEnvelope): SubAgentKind | undefined
  setSessionSubAgentKind(task: TaskEnvelope, kind: SubAgentKind | undefined): void
  isRemoteSafeModeEnabled(): boolean
  setRemoteSafeMode(enabled: boolean): void
  setSessionModelByKey(source: TaskEnvelope['source'], sourceId: string, model: string): void
  setSessionSandboxModeByKey(
    source: TaskEnvelope['source'],
    sourceId: string,
    mode: 'default' | 'strict' | 'off',
  ): void
  getSessionSubAgentKindByKey(source: TaskEnvelope['source'], sourceId: string): SubAgentKind | undefined
  setSessionSubAgentKindByKey(
    source: TaskEnvelope['source'],
    sourceId: string,
    kind: SubAgentKind | undefined,
  ): void
  setActiveBrain(activeBrain: 'local' | 'gemini'): void
  setRouterMode(routerMode: 'always_gemini' | 'always_local' | 'smart'): void
}

export function createRuntimeApi(
  taskQueue: TaskQueue,
  approvals: PendingApprovalCounter,
  services: RuntimeServices,
): RuntimeApi {
  let adminCommandHandler: ((task: TaskEnvelope, input: string) => Promise<string | null>) | null = null

  return {
    async getStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
      return {
        health: {
          version: config.app.version,
          ollamaHost: config.ollama.host,
          remoteSafeMode: services.isRemoteSafeModeEnabled(),
          pendingApprovals: approvals.getPendingApprovalCount(),
        },
        settings: {
          activeBrain: services.getActiveBrain(),
          routerMode: services.getRouterMode(),
          privacyMode: (config as any).privacyMode ?? false,
        },
        activeModel: activeModelState.get(),
        queue: taskQueue.getSnapshot(),
        sessions: {
          count: services.getSessionCount(),
          recent: services.listSessions(10),
        },
        memory: {
          facts: services.countFacts(),
          vectors: await services.countVectors(),
        },
        audit: await services.readRecentAudit(20),
        install: {
          apexInstallRoot: resolveApexInstallRoot(),
          apexInstallRootEnv: process.env.APEX_INSTALL_ROOT?.trim() || null,
        },
      }
    },
    async submitPrompt(input: RuntimePromptSubmission): Promise<string> {
      const task: TaskEnvelope = {
        id: `service-prompt-${Date.now()}`,
        source: input.source,
        sourceId: input.sourceId,
        prompt: input.prompt,
        metadata: input.metadata,
        timeoutMs: 120_000,
      }

      if (adminCommandHandler) {
        const adminResponse = await adminCommandHandler(task, input.prompt)
        if (adminResponse) {
          return adminResponse
        }
      }

      logger.debug(
        `Api enqueuing task ${task.id} correlation=${String((task.metadata as { correlationId?: unknown } | undefined)?.correlationId ?? 'n/a')}`,
      )
      return (await taskQueue.safeEnqueue(task)).response
    },
    setAdminCommandHandler(handler) {
      adminCommandHandler = handler
    },
    onLog(listener) {
      logger.addListener(listener)
    },
    offLog(listener) {
      logger.removeListener(listener)
    },
    listSessions(limit = 10) {
      return services.listSessions(limit)
    },
    listPendingApprovals() {
      const pending = approvals.listPendingApprovals?.() ?? []
      return pending.map((p) => ({
        id: p.id,
        source: p.source,
        sourceId: p.sourceId || 'unknown',
        toolName: p.toolName,
        permissionClass: p.permissionClass,
        command: p.command || '',
        reason: p.reason,
        expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : new Date().toISOString(),
      }))
    },
    settleApproval(id: string, approved: boolean) {
      return approvals.settleApproval?.(id, approved) ?? false
    },
    getSessionModel(task: TaskEnvelope) {
      return services.getSessionModel(task)
    },
    setSessionModel(task: TaskEnvelope, model: string) {
      services.setSessionModel(task, model)
    },
    setSessionModelByKey(source: TaskEnvelope['source'], sourceId: string, model: string) {
      services.setSessionModel({ id: `service-${Date.now()}`, source, sourceId, prompt: '' }, model)
    },
    getSessionSandboxMode(task: TaskEnvelope) {
      return services.getSessionSandboxMode(task)
    },
    setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off') {
      services.setSessionSandboxMode(task, mode)
    },
    getSessionSubAgentKind(task: TaskEnvelope) {
      return services.getSessionSubAgentKind(task)
    },
    setSessionSubAgentKind(task: TaskEnvelope, kind: SubAgentKind | undefined) {
      services.setSessionSubAgentKind(task, kind)
    },
    setSessionSandboxModeByKey(
      source: TaskEnvelope['source'],
      sourceId: string,
      mode: 'default' | 'strict' | 'off',
    ) {
      services.setSessionSandboxMode({ id: `service-${Date.now()}`, source, sourceId, prompt: '' }, mode)
    },
    getSessionSubAgentKindByKey(source: TaskEnvelope['source'], sourceId: string) {
      return services.getSessionSubAgentKind({ id: `service-${Date.now()}`, source, sourceId, prompt: '' })
    },
    setSessionSubAgentKindByKey(
      source: TaskEnvelope['source'],
      sourceId: string,
      kind: SubAgentKind | undefined,
    ) {
      services.setSessionSubAgentKind({ id: `service-${Date.now()}`, source, sourceId, prompt: '' }, kind)
    },
    isRemoteSafeModeEnabled() {
      return services.isRemoteSafeModeEnabled()
    },
    setRemoteSafeMode(enabled: boolean) {
      services.setRemoteSafeMode(enabled)
    },
    setActiveBrain(activeBrain: 'local' | 'gemini') {
      services.setActiveBrain(activeBrain)
    },
    setRouterMode(routerMode: 'always_gemini' | 'always_local' | 'smart') {
      services.setRouterMode(routerMode)
    },
  }
}
