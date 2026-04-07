import 'dotenv/config';
import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { sessionStore } from './sessionStore';
import { createRuntimeHost } from './runtimeHost';
import { registerCoreTools } from '../core/registerTools';

export async function runDaemon() {
  const startupWarnings = await validateStartup();
  for (const warning of startupWarnings) {
    logger.warn(warning);
  }

  registerCoreTools();
  await sessionStore.loadFromDisk();

  let pulseIndex = 0;
  const pulseFrames = ['·', '•', '◦', '•'];
  let shuttingDown = false;
  let statusInterval: NodeJS.Timeout | null = null;
  let runtimeHost: ReturnType<typeof createRuntimeHost>;

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
    logger.system('Daemon shutting down');
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    await runtimeHost.stop();
  };

  runtimeHost = createRuntimeHost(updateStatus, () => {
    logger.system('Runtime stopped');
    process.exit(0);
  });

  runtimeHost.startLifecycle(shutdown);

  logger.system('Resident daemon active');
  logger.system(`Watching: ${config.watcher.directories.join(', ')}`);
  if (runtimeHost.isDashboardEnabled()) {
    logger.system(`Dashboard: http://127.0.0.1:${runtimeHost.getDashboardPort()}`);
  }
  
  await runtimeHost.start();
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);
}

if (require.main === module) {
  runDaemon().catch((error: any) => {
    logger.error(`Daemon error: ${error.message}`);
    process.exit(1);
  });
}
