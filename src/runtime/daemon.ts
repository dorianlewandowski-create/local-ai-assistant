import 'dotenv/config';
import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { sessionStore } from './sessionStore';
import { createRuntimeHost } from './runtimeHost';
import { registerCoreTools } from '../core/registerTools';
import fs from 'fs';
import path from 'path';

function logDaemonError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log');
  const message = `[${new Date().toISOString()}] DAEMON ERROR: ${error.stack || error.message}\n`;
  fs.appendFileSync(logPath, message);
  console.error(message);
}

export async function runDaemon() {
  try {
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
      logger.system('Daemon shutting down...');
      if (statusInterval) {
        clearInterval(statusInterval);
      }
      if (runtimeHost) {
        await runtimeHost.stop();
      }
      process.exit(0);
    };

    runtimeHost = createRuntimeHost(updateStatus, () => {
      if (!shuttingDown) void shutdown();
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

    // Stay alive
    return new Promise<void>(() => {});
  } catch (error: any) {
    logDaemonError(error);
    throw error;
  }
}

if (require.main === module) {
  void (async () => {
    try {
      await runDaemon();
    } catch (error: any) {
      logDaemonError(error);
      process.exit(1);
    }
  })();
}
