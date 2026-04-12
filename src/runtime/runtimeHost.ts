import { AuthorizationRequester, AuthorizationRequest } from '../gateways/base'
import { createAppContext } from './appContext'
import { composeGateways } from './gatewayComposition'
import { attachProcessLifecycle } from './lifecycle'
import { createRuntimeCore } from './runtimeCore'
import { createRuntimeRunner } from './runtimeRunner'
import { config } from '@apex/core'
import { LocalConsoleRuntime } from '../clients/localConsole'
import { logger, LoggerSink } from '../utils/logger'
import { TaskQueueSnapshot } from './taskQueue'
import { createRuntimeServiceServer } from './serviceServer'
import { createRuntimeServiceClient } from './serviceClient'
import { ensureRuntimeServiceTokenWithMeta, getDefaultRuntimeServiceTokenPath } from './runtimeServiceToken'
import { sessionLogger } from './sessionLogger'
import { getVectorStore } from '../db/vectorStore'
import { startMenuBarBrainSelector } from '../services/menuBarBrainSelector'

export interface RuntimeHost {
  appContext: ReturnType<typeof createAppContext>
  localConsole: LocalConsoleRuntime
  getQueueSnapshot(): TaskQueueSnapshot
  getStatusLine(pulse: string, mode: string): string
  getRuntimeServicePort(): number
  startLifecycle(shutdown: () => Promise<void>): void
  start(): Promise<void>
  stop(): Promise<void>
  registerLocalAuthorizer(authorizer: AuthorizationRequester): void
  unregisterLocalAuthorizer(authorizer: AuthorizationRequester): void
  attachLoggerSink(sink: LoggerSink): void
  detachLoggerSink(sink: LoggerSink): void
}

export interface LocalRuntimeHostView {
  localConsole: LocalConsoleRuntime
  registerLocalAuthorizer(authorizer: AuthorizationRequester): void
  unregisterLocalAuthorizer(authorizer: AuthorizationRequester): void
  attachLoggerSink(sink: LoggerSink): void
  detachLoggerSink(sink: LoggerSink): void
}

export function createRuntimeHost(onStatusChange: () => void, onShutdown: () => void): RuntimeHost {
  const tokenMeta = ensureRuntimeServiceTokenWithMeta()
  const runtimeAuthToken = tokenMeta.token

  let localAuthorizer: AuthorizationRequester | null = null
  const authorizerProxy: AuthorizationRequester = {
    async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
      if (localAuthorizer) {
        return await localAuthorizer.requestAuthorization(request)
      }
      return false
    },
  }

  const { orchestrator, taskQueue } = createRuntimeCore()
  const appContext = createAppContext(taskQueue)
  const gateways = composeGateways(orchestrator, appContext, authorizerProxy, {
    runtimeToken: runtimeAuthToken,
  })
  const appContextWithApprovals = createAppContext(taskQueue, gateways.approvalCounter)
  const runtimeRunner = createRuntimeRunner(appContextWithApprovals.taskQueue, onStatusChange)
  const runtimeService = createRuntimeServiceServer(appContextWithApprovals.api, {
    expectedToken: runtimeAuthToken,
  })
  const runtimeClient = createRuntimeServiceClient(`http://127.0.0.1:${config.runtimeService.port}`, {
    runtimeToken: runtimeAuthToken,
  })
  let lifecycle: ReturnType<typeof attachProcessLifecycle> | null = null

  return {
    appContext: appContextWithApprovals,
    localConsole: {
      async runPrompt(prompt: string): Promise<string | null> {
        const adminResponse = await appContextWithApprovals.adminCommands(
          {
            id: `terminal-admin-${Date.now()}`,
            source: 'terminal',
            sourceId: 'local-console',
            prompt,
          },
          prompt,
        )
        if (adminResponse) {
          return adminResponse
        }

        logger.chat('user', prompt)
        return await runtimeClient.submitPrompt('terminal', 'local-console', prompt)
      },
    } satisfies LocalConsoleRuntime,
    getQueueSnapshot() {
      return appContextWithApprovals.taskQueue.getSnapshot()
    },
    getStatusLine(pulse: string, mode: string) {
      const snapshot = appContextWithApprovals.taskQueue.getSnapshot()
      return `${pulse} 󱐋 APEX ${config.app.version} | VAULT: LOCKED | AI: ${config.app.statusAiLabel} | Q:${snapshot.active}/${snapshot.pending} | MODE: ${mode}`
    },
    getRuntimeServicePort() {
      return runtimeService.getPort()
    },
    startLifecycle(shutdown: () => Promise<void>) {
      lifecycle = attachProcessLifecycle(shutdown)
    },
    async start() {
      if (tokenMeta.createdNew) {
        const tokenPath = getDefaultRuntimeServiceTokenPath()
        logger.system('[Apex] First run: created the local runtime API token.')
        logger.system(`  • Path: ${tokenPath} (mode 0600)`)
        logger.system(
          `  • This secures http://127.0.0.1:${config.runtimeService.port}/api/* (GET /health stays unauthenticated).`,
        )
        logger.system(
          '  • If you later see HTTP 401 from clients, restart the daemon once and align ~/.apex/runtime.token with the running process (or env overrides).',
        )
        logger.system('  • Details: docs/OPERATOR_TRUST.txt')
        logger.system('  • Inspect anytime: apex runtime-info')
      }
      startMenuBarBrainSelector()
      runtimeRunner.start()
      await Promise.all([runtimeService.start(), gateways.startAll(config.gateways.telegram.enabled)])
    },
    async stop() {
      await runtimeRunner.stop()
      await gateways.stopAll()
      await runtimeService.stop()
      lifecycle?.detach()
      onShutdown()
    },
    registerLocalAuthorizer(authorizer: AuthorizationRequester) {
      localAuthorizer = authorizer
    },
    unregisterLocalAuthorizer(authorizer: AuthorizationRequester) {
      if (localAuthorizer === authorizer) {
        localAuthorizer = null
      }
    },
    attachLoggerSink(sink: LoggerSink) {
      logger.addSink(sink)
      if (logger.patchConsole) {
        logger.patchConsole()
      }
      sessionLogger.start()
      logger.setMirror(sessionLogger)
      const vectorStore = getVectorStore()

      logger.system('🔒 Security: Encrypted Vault Linked & Local AI Isolated.')
      logger.system(`📝 Session log: ${sessionLogger.getPath()}`)
      logger.system(`🗂️ Vector store: ${vectorStore.getPath()}`)
      if (vectorStore.isUsingFallbackPath()) {
        logger.warn('Configured VECTOR_STORE_PATH is not writable. Using local fallback vector store.')
      }
    },
    detachLoggerSink(sink: LoggerSink) {
      logger.removeSink(sink)
      if (logger.restoreConsole) {
        logger.restoreConsole()
      }
      sessionLogger.stop()
      logger.setMirror(null)
    },
  }
}
