import { AuthorizationRequester } from '../gateways/base';
import { createAppContext } from './appContext';
import { composeGateways } from './gatewayComposition';
import { attachProcessLifecycle } from './lifecycle';
import { createRuntimeCore } from './runtimeCore';
import { createRuntimeRunner } from './runtimeRunner';
import { config } from '../config';
import { LocalConsoleRuntime } from '../clients/localConsole';
import { logger } from '../utils/logger';
import { TaskQueueSnapshot } from './taskQueue';
import { createRuntimeServiceServer } from './serviceServer';

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
}

export interface LocalRuntimeHostView {
  localConsole: LocalConsoleRuntime;
}

export function createRuntimeHost(localAuthorizer: AuthorizationRequester, onStatusChange: () => void, onShutdown: () => void): RuntimeHost {
  const { orchestrator, taskQueue } = createRuntimeCore();
  const appContext = createAppContext(taskQueue);
  const gateways = composeGateways(orchestrator, taskQueue, appContext, localAuthorizer);
  const appContextWithApprovals = createAppContext(taskQueue, gateways.approvalCounter);
  const runtimeRunner = createRuntimeRunner(appContextWithApprovals.taskQueue, onStatusChange);
  const runtimeService = createRuntimeServiceServer(appContextWithApprovals.api);
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
        const result = await taskQueue.enqueue({
          id: `terminal-${Date.now()}`,
          source: 'terminal',
          sourceId: 'local-console',
          prompt,
          timeoutMs: 120_000,
        });
        return result.response;
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
  };
}
