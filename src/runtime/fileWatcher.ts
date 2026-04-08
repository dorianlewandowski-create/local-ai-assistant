import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { TaskQueue } from './taskQueue';
import { logger } from '../utils/logger';
import { config } from '../config';

function shouldHandleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return config.watcher.extensions.has(ext);
}

async function buildFileEventPrompt(eventType: 'add' | 'change', filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase() || 'no extension';
  const sizeKb = Math.max(1, Math.round(stats.size / 1024));

  return [
    'Resident event detected.',
    `Event: ${eventType}.`,
    `Path: ${filePath}.`,
    `Extension: ${ext}.`,
    `SizeKB: ${sizeKb}.`,
    'Analyze whether this file needs organization, review, summarization, or user notification.',
    'If the event reveals a stable user preference or pattern, save it as a fact.',
    'If memory might help, recall relevant facts before deciding what to do.',
    'Finish only after deciding on the best next action.',
  ].join(' ');
}

export function startResidentFileWatcher(taskQueue: TaskQueue, onTaskSettled: () => void) {
  const watcher = chokidar.watch(config.watcher.directories, {
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
    void taskQueue.safeEnqueue({
      id: `${label}-${Date.now()}`,
      source: 'file_watcher',
      sourceId: 'resident-watch',
      prompt: eventPrompt,
      metadata: { eventType, filePath },
      timeoutMs: 60_000,
    }).then((result) => {
      logger.chat('assistant', `[FileWatcher] ${result.response}`);
      onTaskSettled();
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

  return watcher;
}
