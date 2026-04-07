import { AuthorizationRequester, AuthorizationRequest } from '../gateways/base';
import { createAppContext } from './appContext';
import { composeGateways } from './gatewayComposition';
import { attachProcessLifecycle } from './lifecycle';
import { createRuntimeCore } from './runtimeCore';
import { createRuntimeRunner } from './runtimeRunner';
import { config } from '../config';
import { LocalConsoleRuntime } from '../clients/localConsole';
import { logger, LoggerSink } from '../utils/logger';
import { TaskQueueSnapshot } from './taskQueue';
import { createRuntimeServiceServer } from './serviceServer';
import { createRuntimeServiceClient } from './serviceClient';
import { sessionLogger } from './sessionLogger';
import { vectorStore } from '../db/vectorStore';

export interface RuntimeHost {
  appContext: ReturnType<typeof createAppContext>;
  localConsole: LocalConsoleRuntime;
  getQueueSnapshot(): TaskQueueSnapshot;
  getStatusLine(pulse: string, mode: string): string;
  isDashboardEnabled(): boolean;
  getRuntimeServicePort(): number;
  getDashboardPort(): number;
  startLifecycle(shutdown: () => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  registerLocalAuthorizer(authorizer: AuthorizationRequester): void;
  unregisterLocalAuthorizer(authorizer: AuthorizationRequester): void;
  attachLoggerSink(sink: LoggerSink): void;
  detachLoggerSink(sink: LoggerSink): void;
}

export interface LocalRuntimeHostView {
  localConsole: LocalConsoleRuntime;
  registerLocalAuthorizer(authorizer: AuthorizationRequester): void;
  unregisterLocalAuthorizer(authorizer: AuthorizationRequester): void;
  attachLoggerSink(sink: LoggerSink): void;
  detachLoggerSink(sink: LoggerSink): void;
}

export function createRuntimeHost(onStatusChange: () => void, onShutdown: () => void): RuntimeHost {
  let localAuthorizer: AuthorizationRequester | null = null;
  const authorizerProxy: AuthorizationRequester = {
    async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
      if (localAuthorizer) {
        return await localAuthorizer.requestAuthorization(request);
      }
      return false;
    },
  };

  const { orchestrator, taskQueue } = createRuntimeCore();
  const appContext = createAppContext(taskQueue);
  const gateways = composeGateways(orchestrator, appContext, authorizerProxy);
  const appContextWithApprovals = createAppContext(taskQueue, gateways.approvalCounter);
  const runtimeRunner = createRuntimeRunner(appContextWithApprovals.taskQueue, onStatusChange);
  const runtimeService = createRuntimeServiceServer(appContextWithApprovals.api);
  const runtimeClient = createRuntimeServiceClient(`http://127.0.0.1:${config.runtimeService.port}`);
  let lifecycle: ReturnType<typeof attachProcessLifecycle> | null = null;

  return {
    appContext: appContextWithApprovals,
    localConsole: {
      async runPrompt(prompt: string): Promise<string | null> {
        const adminResponse = await appContextWithApprovals.adminCommands({
          id: `terminal-admin-${Date.now()}`,
          source: 'terminal',
          sourceId: 'local-console',
          prompt,
        }, prompt);
        if (adminResponse) {
          return adminResponse;
        }

        logger.chat('user', prompt);
        return await runtimeClient.submitPrompt('terminal', 'local-console', prompt);
      },
    } satisfies LocalConsoleRuntime,
    getQueueSnapshot() {
      return appContextWithApprovals.taskQueue.getSnapshot();
    },
    getStatusLine(pulse: string, mode: string) {
      const snapshot = appContextWithApprovals.taskQueue.getSnapshot();
      return `${pulse}  OPENMAC ${config.app.version} | VAULT: LOCKED | AI: ${config.app.statusAiLabel} | Q:${snapshot.active}/${snapshot.pending} | MODE: ${mode}`;
    },
    isDashboardEnabled() {
      return config.dashboard.enabled;
    },
    getRuntimeServicePort() {
      return runtimeService.getPort();
    },
    getDashboardPort() {
      return appContextWithApprovals.dashboard.getPort();
    },
    startLifecycle(shutdown: () => Promise<void>) {
      lifecycle = attachProcessLifecycle(shutdown);
    },
    async start() {
      runtimeRunner.start();
      await Promise.all([
        runtimeService.start(),
        gateways.startAll(config.gateways.telegram.enabled),
        appContextWithApprovals.dashboard.start(),
      ]);
    },
    async stop() {
      await runtimeRunner.stop();
      await gateways.stopAll();
      await runtimeService.stop();
      await appContextWithApprovals.dashboard.stop();
      lifecycle?.detach();
      onShutdown();
    },
    registerLocalAuthorizer(authorizer: AuthorizationRequester) {
      localAuthorizer = authorizer;
    },
    unregisterLocalAuthorizer(authorizer: AuthorizationRequester) {
      if (localAuthorizer === authorizer) {
        localAuthorizer = null;
      }
    },
    attachLoggerSink(sink: LoggerSink) {
      logger.addSink(sink);
      if (logger.patchConsole) {
        logger.patchConsole();
      }
      sessionLogger.start();
      logger.setMirror(sessionLogger);
      
      logger.system('🔒 Security: Encrypted Vault Linked & Local AI Isolated.');
      logger.system(`📝 Session log: ${sessionLogger.getPath()}`);
      logger.system(`🗂️ Vector store: ${vectorStore.getPath()}`);
      if (vectorStore.isUsingFallbackPath()) {
        logger.warn('Configured VECTOR_STORE_PATH is not writable. Using local fallback vector store.');
      }
    },
    detachLoggerSink(sink: LoggerSink) {
      logger.removeSink(sink);
      if (logger.restoreConsole) {
        logger.restoreConsole();
      }
      sessionLogger.stop();
      logger.setMirror(null);
    },
  };
}
