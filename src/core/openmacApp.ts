import { Orchestrator } from '../agent/orchestrator';
import { toolRegistry } from '../tools/registry';
import { TaskQueue } from '../runtime/taskQueue';
import { logger } from '../utils/logger';
import { createWhatsAppGateway } from '../gateways/whatsapp';
import { createTelegramGateway } from '../gateways/telegram';
import { createSlackGateway } from '../gateways/slack';
import { config } from '../config';
import { validateStartup } from '../startupValidation';
import { openMacAssistantConfig } from './assistantConfig';
import { createProactiveScheduler } from '../runtime/proactiveScheduler';
import { createTuiClient } from '../clients/tuiClient';
import { startResidentFileWatcher } from '../runtime/fileWatcher';
import { AuthorizationRequest, TaskSource } from '../types';

function createFailClosedRemoteAuthorizer(source: TaskSource) {
  return {
    async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
      logger.warn(`Authorization denied for ${source}: no remote approval flow is implemented for this channel.`);
      logger.chat('assistant', `[${source}] Approval required for ${request.toolName}, but this channel does not support remote approvals yet.`);
      return false;
    },
  };
}

export async function runOpenMac(argv: string[] = process.argv.slice(2)) {
  const startupWarnings = await validateStartup();
  for (const warning of startupWarnings) {
    logger.warn(warning);
  }

  const { tui, destroy } = createTuiClient();

  openMacAssistantConfig.tools = toolRegistry.getAllTools().map((tool) => tool.name);
  const orchestrator = new Orchestrator(openMacAssistantConfig);
  const taskQueue = new TaskQueue((task) => orchestrator.processTask(task));
  const whatsappGateway = createWhatsAppGateway(taskQueue);
  const telegramGateway = createTelegramGateway(taskQueue);
  const slackGateway = createSlackGateway(taskQueue);

  orchestrator.registerGateway('whatsapp', whatsappGateway);
  orchestrator.registerGateway('telegram', telegramGateway);
  orchestrator.registerGateway('slack', slackGateway);
  orchestrator.registerAuthorizer('telegram', telegramGateway);
  orchestrator.registerAuthorizer('whatsapp', createFailClosedRemoteAuthorizer('whatsapp'));
  orchestrator.registerAuthorizer('slack', createFailClosedRemoteAuthorizer('slack'));
  orchestrator.registerAuthorizer('terminal', tui);
  orchestrator.registerAuthorizer('file_watcher', tui);
  orchestrator.registerAuthorizer('scheduler', tui);
  orchestrator.registerAuthorizer('default', tui);

  const prompt = argv.join(' ').trim();
  let pulseIndex = 0;
  const pulseFrames = ['·', '•', '◦', '•'];
  let shuttingDown = false;
  let statusInterval: NodeJS.Timeout | null = null;
  let watcher: ReturnType<typeof startResidentFileWatcher> | null = null;

  const updateStatus = () => {
    const snapshot = taskQueue.getSnapshot();
    const activeTasks = snapshot.active;
    const pulse = activeTasks > 0 ? pulseFrames[pulseIndex++ % pulseFrames.length] : '●';
    const mode = activeTasks > 0 ? 'FAST-PATH ○' : 'FAST-PATH ⚡';
    logger.status(`${pulse}  OPENMAC ${config.app.version} | VAULT: LOCKED | AI: ${config.app.statusAiLabel} | Q:${snapshot.active}/${snapshot.pending} | MODE: ${mode}`);
  };

  const proactiveScheduler = createProactiveScheduler(taskQueue, updateStatus);

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.system('Shutting down');
    proactiveScheduler.stop();
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    await whatsappGateway.stop();
    await telegramGateway.stop();
    await slackGateway.stop();
    await watcher?.close();
    destroy();
    process.exit(0);
  };

  tui.onSubmit((value) => {
    if (value.trim() === '/exit') {
      void shutdown();
      return;
    }

    logger.chat('user', value);
    void taskQueue.enqueue({
      id: `terminal-${Date.now()}`,
      source: 'terminal',
      sourceId: 'local-console',
      prompt: value,
      timeoutMs: 120_000,
    }).then((result) => {
      logger.chat('assistant', result.response);
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Terminal prompt failed: ${error.message}`);
    });
  });

  if (prompt) {
    logger.chat('user', prompt);
    void taskQueue.enqueue({
      id: `terminal-${Date.now()}`,
      source: 'terminal',
      sourceId: 'local-console',
      prompt,
      timeoutMs: 120_000,
    }).then((result) => {
      logger.chat('assistant', result.response);
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Terminal prompt failed: ${error.message}`);
    });
  }

  logger.system('Resident mode active');
  logger.system(`Watching: ${config.watcher.directories.join(', ')}`);
  proactiveScheduler.start();
  await Promise.all([
    whatsappGateway.start(),
    config.gateways.telegram.enabled
      ? telegramGateway.start()
      : Promise.resolve().then(() => logger.system('Telegram disabled')),
    slackGateway.start(),
  ]);
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);
  watcher = startResidentFileWatcher(taskQueue, updateStatus);

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
