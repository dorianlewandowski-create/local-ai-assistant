import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { createLocalTuiClient } from '../clients/localTuiClient';
import { createRemoteTuiClient } from '../clients/remoteTuiClient';
import { sessionStore } from '../runtime/sessionStore';
import { createRuntimeHost } from '../runtime/runtimeHost';
import { createRuntimeServiceClient } from '../runtime/serviceClient';
import fs from 'fs';
import path from 'path';

function logStartupError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log');
  const message = `[${new Date().toISOString()}] STARTUP ERROR: ${error.stack || error.message}\n`;
  fs.appendFileSync(logPath, message);
  console.error(message);
}

export async function runOpenMac(argv: string[] = process.argv.slice(2)) {
  const logPath = path.join(process.cwd(), 'debug.log');
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Starting runOpenMac with args: ${argv.join(' ')}\n`);

    const client = createRuntimeServiceClient();
    let isRunning = false;
    try {
      await client.getStatusSnapshot();
      isRunning = true;
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Daemon detected as running.\n`);
    } catch {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Daemon not detected.\n`);
    }

    if (isRunning) {
      const remoteClient = createRemoteTuiClient();
      remoteClient.tui.onExit(() => {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Remote TUI exit triggered.\n`);
        process.exit(0);
      });
      remoteClient.attach();

      const prompt = argv.join(' ').trim();
      if (prompt) {
        await remoteClient.runInitialPrompt(prompt);
      }
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Remote client path waiting...\n`);
      return new Promise<void>(() => {});
    }

    const startupWarnings = await validateStartup();
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Startup validation done.\n`);
    for (const warning of startupWarnings) {
      logger.warn(warning);
    }

    await sessionStore.loadFromDisk();
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Session store loaded.\n`);

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
      logger.system('Shutting down...');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Shutdown triggered.\n`);
      if (statusInterval) {
        clearInterval(statusInterval);
      }
      if (runtimeHost) {
        await runtimeHost.stop();
      }
      if (localClient) {
        localClient.destroy();
      }
      process.exit(0);
    };

    runtimeHost = createRuntimeHost(updateStatus, () => {
      if (!shuttingDown) void shutdown();
    });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Runtime host created.\n`);
    
    localClient = createLocalTuiClient(runtimeHost, updateStatus, shutdown);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Local client created.\n`);

    runtimeHost.startLifecycle(shutdown);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Lifecycle started.\n`);
    
    localClient.attach();
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Local client attached.\n`);

    if (prompt) {
      await localClient.runInitialPrompt(prompt);
    }

    logger.system('Resident mode active');
    logger.system(`Watching: ${config.watcher.directories.join(', ')}`);
    if (runtimeHost.isDashboardEnabled()) {
      logger.system(`Dashboard: http://127.0.0.1:${runtimeHost.getDashboardPort()}`);
    }
    
    await runtimeHost.start();
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Runtime host started.\n`);
    
    updateStatus();
    statusInterval = setInterval(updateStatus, 5000);

    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Reached end of runOpenMac, staying alive...\n`);
    // Stay alive
    return new Promise<void>(() => {});
  } catch (error: any) {
    logStartupError(error);
    throw error;
  }
}
