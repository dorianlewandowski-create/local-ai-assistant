import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { createLocalTuiClient } from '../clients/localTuiClient';
import { createRemoteTuiClient } from '../clients/remoteTuiClient';
import { sessionStore } from '../runtime/sessionStore';
import { createRuntimeHost } from '../runtime/runtimeHost';
import { createRuntimeServiceClient } from '../runtime/serviceClient';

export async function runOpenMac(argv: string[] = process.argv.slice(2)) {
  const client = createRuntimeServiceClient();
  let isRunning = false;
  try {
    await client.getStatusSnapshot();
    isRunning = true;
  } catch {
    // Daemon not running
  }

  if (isRunning) {
    const remoteClient = createRemoteTuiClient();
    remoteClient.attach();
    const prompt = argv.join(' ').trim();
    if (prompt) {
      await remoteClient.runInitialPrompt(prompt);
    }
    return;
  }

  const startupWarnings = await validateStartup();
  for (const warning of startupWarnings) {
    logger.warn(warning);
  }

  await sessionStore.loadFromDisk();

  const prompt = argv.join(' ').trim();
  let pulseIndex = 0;
  const pulseFrames = ['·', '•', '◦', '•'];
  let shuttingDown = false;
  let statusInterval: NodeJS.Timeout | null = null;
  let runtimeHost: ReturnType<typeof createRuntimeHost>;
  let localClient: ReturnType<typeof createLocalTuiClient>;

  const updateStatus = () => {
    const snapshot = runtimeHost.getQueueSnapshot();
    const activeTasks = snapshot.active;
    const pulse = activeTasks > 0 ? pulseFrames[pulseIndex++ % pulseFrames.length] : '●';
    const mode = activeTasks > 0 ? 'FAST-PATH ○' : 'FAST-PATH ⚡';
    logger.status(runtimeHost.getStatusLine(pulse, mode));
  };

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.system('Shutting down');
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    await runtimeHost.stop();
  };

  runtimeHost = createRuntimeHost(updateStatus, () => {
    localClient.destroy();
    process.exit(0);
  });
  localClient = createLocalTuiClient(runtimeHost, updateStatus, shutdown);

  runtimeHost.startLifecycle(shutdown);
  localClient.attach();

  if (prompt) {
    await localClient.runInitialPrompt(prompt);
  }

  logger.system('Resident mode active');
  logger.system(`Watching: ${config.watcher.directories.join(', ')}`);
  if (runtimeHost.isDashboardEnabled()) {
    logger.system(`Dashboard: http://127.0.0.1:${runtimeHost.getDashboardPort()}`);
  }
  await runtimeHost.start();
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);
}
