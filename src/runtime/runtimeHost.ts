import { AuthorizationRequester } from '../gateways/base';
import { createAppContext } from './appContext';
import { composeGateways } from './gatewayComposition';
import { attachProcessLifecycle } from './lifecycle';
import { createRuntimeCore } from './runtimeCore';
import { createRuntimeRunner } from './runtimeRunner';
import { config } from '../config';

export function createRuntimeHost(localAuthorizer: AuthorizationRequester, onStatusChange: () => void, onShutdown: () => void) {
  const { orchestrator, taskQueue } = createRuntimeCore();
  const appContext = createAppContext(taskQueue);
  const gateways = composeGateways(orchestrator, taskQueue, appContext, localAuthorizer);
  const appContextWithApprovals = createAppContext(taskQueue, gateways.approvalCounter);
  const runtimeRunner = createRuntimeRunner(appContextWithApprovals.taskQueue, onStatusChange);
  let lifecycle: ReturnType<typeof attachProcessLifecycle> | null = null;

  return {
    appContext: appContextWithApprovals,
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
