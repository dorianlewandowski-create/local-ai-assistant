import { AuthorizationRequester } from '../gateways/base';
import { createAppContext } from './appContext';
import { composeGateways } from './gatewayComposition';
import { attachProcessLifecycle } from './lifecycle';
import { createRuntimeCore } from './runtimeCore';
import { createRuntimeRunner } from './runtimeRunner';
import { config } from '../config';
import { LocalConsoleRuntime } from '../clients/localConsole';

export interface RuntimeHost {
  appContext: ReturnType<typeof createAppContext>;
  localConsole: LocalConsoleRuntime;
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
  let lifecycle: ReturnType<typeof attachProcessLifecycle> | null = null;

  return {
    appContext: appContextWithApprovals,
    localConsole: {
      taskQueue,
      adminCommands: appContextWithApprovals.adminCommands,
    } satisfies LocalConsoleRuntime,
    startLifecycle(shutdown: () => Promise<void>) {
      lifecycle = attachProcessLifecycle(shutdown);
    },
    async start() {
      runtimeRunner.start();
      await Promise.all([
        gateways.startAll(config.gateways.telegram.enabled),
        appContextWithApprovals.dashboard.start(),
      ]);
    },
    async stop() {
      await runtimeRunner.stop();
      await gateways.stopAll();
      await appContextWithApprovals.dashboard.stop();
      lifecycle?.detach();
      onShutdown();
    },
  };
}
