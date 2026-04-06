import 'dotenv/config';
import { Orchestrator } from './agent/orchestrator';
import { AgentConfig } from './types';
import { toolRegistry } from './tools/registry';
import { TaskQueue } from './runtime/taskQueue';
import { OpenMacTui } from './ui/tui';
import { logger } from './utils/logger';
import { memoryStore } from './db/memory';
import { sessionLogger } from './runtime/sessionLogger';
import { execSync } from 'child_process';
import chokidar from 'chokidar';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import './tools/macControl';
import './tools/fileSystem';
import './tools/reminders';
import './tools/browser';
import './tools/calendar';
import './tools/fsAdvanced';
import './tools/webSearch';
import './tools/systemMisc';
import './tools/memory';
import './tools/fileContent';
import { createWhatsAppGateway } from './gateways/whatsapp';
import { createTelegramGateway } from './gateways/telegram';
import { createSlackGateway } from './gateways/slack';

const WATCH_DIRECTORIES = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Downloads'),
];

const WATCHED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png']);
const PROACTIVE_REVIEW_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MORNING_REVIEW_HOUR = 8;
const INTERNAL_REVIEW_PROMPT = 'Internal Review: Access the calendar for today, fetch the current weather forecast, and recall relevant facts from Memory. Identify any potential issues, such as bad weather conflicting with outdoor plans or stress factors involving pets. Only notify the user if you find a meaningful Contextual Correlation that supports a useful proactive suggestion. If nothing meaningful is found, do not send a notification and finish quietly.';
const INTERNAL_REVIEW_SYSTEM_PROMPT = 'Hidden system instruction for proactive planning. This is an internal review, not a user request. Check today\'s calendar, current weather, and relevant memory together. Avoid spam. Only call send_system_notification when there is a meaningful contextual correlation that is specific, actionable, and not a duplicate of a recent proactive alert. Otherwise finish without notifying.';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || 'gemma4:e4b';

const MacOSAssistant: AgentConfig = {
  name: 'OpenMac',
  model: DEFAULT_OLLAMA_MODEL,
   systemPrompt: `You are OpenMac, a high-end macOS autonomous agent.
   You can monitor the system, react to file events, remember durable user facts, and take careful autonomous actions.
   When a new event appears, analyze it, decide whether to use tools, and either take the next best action or produce a concise recommendation.
   You are aware of the user's schedule. You can check the calendar to provide context-aware help. If the user asks 'What's my day like?', use get_today_schedule.
   You are now a macOS Power User. You can control the OS via AppleScript. If a task requires UI interaction (Spotify, Settings, Finder), write a precise AppleScript and execute it. Only claim Spotify playback succeeded if the tool explicitly confirms it. Always inform the user what you are about to do. Always confirm risky actions via the Gatekeeper Popup.
   When responding to Telegram, be elite, concise, and use the  OpenMac signature.
   Be thoughtful, safe, and useful.`,
   tools: [] // Dynamically populated below
};

function shouldHandleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return WATCHED_EXTENSIONS.has(ext);
}

async function buildFileEventPrompt(eventType: 'add' | 'change', filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase() || 'no extension';
  const sizeKb = Math.max(1, Math.round(stats.size / 1024));

  return [
    `Resident event detected.`,
    `Event: ${eventType}.`,
    `Path: ${filePath}.`,
    `Extension: ${ext}.`,
    `SizeKB: ${sizeKb}.`,
    `Analyze whether this file needs organization, review, summarization, or user notification.`,
    `If the event reveals a stable user preference or pattern, save it as a fact.`,
    `If memory might help, recall relevant facts before deciding what to do.`,
    `Finish only after deciding on the best next action.`
  ].join(' ');
}

function createProactiveScheduler(taskQueue: TaskQueue, onReviewComplete?: () => void) {
  let lastMorningReviewKey = '';

  const runReview = (reason: 'interval' | 'morning') => {
    void taskQueue.enqueue({
      id: `proactive-review-${reason}-${Date.now()}`,
      source: 'scheduler',
      prompt: INTERNAL_REVIEW_PROMPT,
      supplementalSystemPrompt: INTERNAL_REVIEW_SYSTEM_PROMPT,
      trackProactiveNotifications: true,
      metadata: { reason },
    }).then((result) => {
      logger.chat('assistant', `[Proactive Review] ${result.response}`);
      onReviewComplete?.();
    }).catch((error: any) => {
      logger.error(`Scheduler proactive review failed: ${error.message}`);
    });
  };

  const intervalHandle = setInterval(() => {
    runReview('interval');
  }, PROACTIVE_REVIEW_INTERVAL_MS);

  const morningHandle = setInterval(() => {
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (now.getHours() === MORNING_REVIEW_HOUR && lastMorningReviewKey !== currentKey) {
      lastMorningReviewKey = currentKey;
      runReview('morning');
    }
  }, 60 * 1000);

  return {
    start() {
      const now = new Date();
      const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      if (now.getHours() === MORNING_REVIEW_HOUR) {
        lastMorningReviewKey = currentKey;
        runReview('morning');
      }
    },
    stop() {
      clearInterval(intervalHandle);
      clearInterval(morningHandle);
    },
  };
}

async function main() {
  const vectorStorePath = process.env.VECTOR_STORE_PATH?.trim();
  if (vectorStorePath?.startsWith('/Volumes/') && !existsSync(vectorStorePath)) {
    throw new Error('🚨 VAULT NOT FOUND: Please mount your encrypted OpenMacData volume to continue.');
  }

  const ollamaHost = process.env.OLLAMA_HOST?.trim();
  if (ollamaHost && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(ollamaHost)) {
    throw new Error(`Ollama must be local-only. Invalid OLLAMA_HOST: ${ollamaHost}`);
  }

  const tui = new OpenMacTui();
  logger.setSink(tui);
  sessionLogger.start();
  logger.setMirror(sessionLogger);
  logger.patchConsole();
  logger.system('🔒 Security: Encrypted Vault Linked & Local AI Isolated.');
  logger.system(`📝 Session log: ${sessionLogger.getPath()}`);

  MacOSAssistant.tools = toolRegistry.getAllTools().map(t => t.name);
  const orchestrator = new Orchestrator(MacOSAssistant);
  const taskQueue = new TaskQueue((task) => orchestrator.processTask(task));
  const whatsappGateway = createWhatsAppGateway(taskQueue);
  const telegramGateway = createTelegramGateway(taskQueue);
  const slackGateway = createSlackGateway(taskQueue);
  orchestrator.registerGateway('whatsapp', whatsappGateway);
  orchestrator.registerGateway('telegram', telegramGateway);
  orchestrator.registerGateway('slack', slackGateway);
  orchestrator.registerAuthorizer('telegram', telegramGateway);
  orchestrator.registerAuthorizer('terminal', tui);
  orchestrator.registerAuthorizer('file_watcher', tui);
  orchestrator.registerAuthorizer('scheduler', tui);
  orchestrator.registerAuthorizer('default', tui);
  const prompt = process.argv.slice(2).join(' ').trim();
  let pulseIndex = 0;
  const pulseFrames = ['·', '•', '◦', '•'];
  let shuttingDown = false;
  let statusInterval: NodeJS.Timeout | null = null;
  let watcher: ReturnType<typeof chokidar.watch> | null = null;

  const updateStatus = () => {
    const activeTasks = taskQueue.getActiveTaskCount();
    const pulse = activeTasks > 0 ? pulseFrames[pulseIndex++ % pulseFrames.length] : '●';
    const mode = activeTasks > 0 ? 'FAST-PATH ○' : 'FAST-PATH ⚡';
    logger.status(`${pulse}  OPENMAC 0.6.0 | VAULT: LOCKED | AI: GEMMA-4 | MODE: ${mode}`);
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
    logger.restoreConsole();
    sessionLogger.stop();
    logger.setMirror(null);
    logger.setSink(null);
    tui.destroy();
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
      prompt: value,
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
      prompt,
    }).then((result) => {
      logger.chat('assistant', result.response);
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Terminal prompt failed: ${error.message}`);
    });
  }

  logger.system('Resident mode active');
  logger.system(`Watching: ${WATCH_DIRECTORIES.join(', ')}`);
  proactiveScheduler.start();
  await Promise.all([
    whatsappGateway.start(),
    process.env.TELEGRAM_ENABLED === '1' || process.env.TELEGRAM_ENABLED === 'true'
      ? telegramGateway.start()
      : Promise.resolve().then(() => logger.system('Telegram disabled')),
    slackGateway.start(),
  ]);
  updateStatus();
  statusInterval = setInterval(updateStatus, 5000);

  watcher = chokidar.watch(WATCH_DIRECTORIES, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  const handleEvent = async (eventType: 'add' | 'change', filePath: string) => {
    if (!shouldHandleFile(filePath)) {
      return;
    }

    const label = `${eventType}:${path.basename(filePath)}`;
    const eventPrompt = await buildFileEventPrompt(eventType, filePath);
    void taskQueue.enqueue({
      id: `${label}-${Date.now()}`,
      source: 'file_watcher',
      prompt: eventPrompt,
      metadata: { eventType, filePath },
    }).then((result) => {
      logger.chat('assistant', `[FileWatcher] ${result.response}`);
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Watcher event ${label} failed: ${error.message}`);
    });
  };

  watcher.on('add', (filePath: string) => {
    void handleEvent('add', filePath);
  });

  watcher.on('change', (filePath: string) => {
    void handleEvent('change', filePath);
  });

  watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Watcher error: ${message}`);
  });

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

main().catch((error: any) => {
  logger.error(`Error during processing: ${error.message}`);
  process.exit(1);
});
