import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { createLocalTuiClient } from '../clients/localTuiClient';
import { sessionStore } from '../runtime/sessionStore';
import { createRuntimeHost } from '../runtime/runtimeHost';

export async function runOpenMac(argv: string[] = process.argv.slice(2)) {
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
    logger.status(`${pulse}  OPENMAC ${config.app.version} | VAULT: LOCKED | AI: ${config.app.statusAiLabel} | Q:${snapshot.active}/${snapshot.pending} | MODE: ${mode}`);
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

  runtimeHost = createRuntimeHost({ requestAuthorization: async () => false }, updateStatus, () => {
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
  if (config.dashboard.enabled) {
    logger.system(`Dashboard: http://127.0.0.1:${runtimeHost.appContext.dashboard.getPort()}`);
  }
  await runtimeHost.start();
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);
}
