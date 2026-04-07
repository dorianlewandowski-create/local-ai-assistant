import { Orchestrator } from '../agent/orchestrator';
import { toolRegistry } from '../tools/registry';
import { TaskQueue } from '../runtime/taskQueue';
import { logger } from '../utils/logger';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { openMacAssistantConfig } from './assistantConfig';
import { createTuiClient } from '../clients/tuiClient';
import { attachLocalConsole, runInitialConsolePrompt } from '../clients/localConsole';
import { sessionStore } from '../runtime/sessionStore';
import { createAppContext } from '../runtime/appContext';
import { createRuntimeRunner } from '../runtime/runtimeRunner';
import { composeGateways } from '../runtime/gatewayComposition';

export async function runOpenMac(argv: string[] = process.argv.slice(2)) {
  const startupWarnings = await validateStartup();
  for (const warning of startupWarnings) {
    logger.warn(warning);
  }

  await sessionStore.loadFromDisk();

  const { tui, destroy } = createTuiClient();

  openMacAssistantConfig.tools = toolRegistry.getAllTools().map((tool) => tool.name);
  const orchestrator = new Orchestrator(openMacAssistantConfig);
  const taskQueue = new TaskQueue((task) => orchestrator.processTask(task));
  const appContext = createAppContext(taskQueue);
  const gateways = composeGateways(orchestrator, taskQueue, appContext, tui);
  const appContextWithApprovals = createAppContext(taskQueue, gateways.approvalCounter);

  const prompt = argv.join(' ').trim();
  let pulseIndex = 0;
  const pulseFrames = ['·', '•', '◦', '•'];
  let shuttingDown = false;
  let statusInterval: NodeJS.Timeout | null = null;

  const updateStatus = () => {
    const snapshot = appContextWithApprovals.taskQueue.getSnapshot();
    const activeTasks = snapshot.active;
    const pulse = activeTasks > 0 ? pulseFrames[pulseIndex++ % pulseFrames.length] : '●';
    const mode = activeTasks > 0 ? 'FAST-PATH ○' : 'FAST-PATH ⚡';
    logger.status(`${pulse}  OPENMAC ${config.app.version} | VAULT: LOCKED | AI: ${config.app.statusAiLabel} | Q:${snapshot.active}/${snapshot.pending} | MODE: ${mode}`);
  };

  const runtimeRunner = createRuntimeRunner(appContextWithApprovals.taskQueue, updateStatus);

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.system('Shutting down');
    await runtimeRunner.stop();
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    await gateways.stopAll();
    await appContextWithApprovals.dashboard.stop();
    destroy();
    process.exit(0);
  };

  attachLocalConsole(appContextWithApprovals, tui, updateStatus, shutdown);

  if (prompt) {
    await runInitialConsolePrompt(appContextWithApprovals, prompt, updateStatus);
  }

  logger.system('Resident mode active');
  logger.system(`Watching: ${config.watcher.directories.join(', ')}`);
  if (config.dashboard.enabled) {
    logger.system(`Dashboard: http://127.0.0.1:${appContextWithApprovals.dashboard.getPort()}`);
  }
  runtimeRunner.start();
  await Promise.all([
    gateways.startAll(config.gateways.telegram.enabled),
    appContextWithApprovals.dashboard.start(),
  ]);
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);

  tui.onExit(() => {
    void shutdown();
  });

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });

  process.stdin.resume();
}
