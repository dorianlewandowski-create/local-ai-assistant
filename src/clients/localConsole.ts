import { logger } from '../utils/logger';
import { OpenMacTui } from '../ui/tui';
import { TaskQueue } from '../runtime/taskQueue';
import { TaskEnvelope } from '../types';

export interface LocalConsoleRuntime {
  taskQueue: TaskQueue;
  adminCommands: (task: TaskEnvelope, input: string) => Promise<string | null>;
}

export function attachLocalConsole(runtime: LocalConsoleRuntime, tui: OpenMacTui, updateStatus: () => void, shutdown: () => void) {
  tui.onSubmit((value) => {
    if (value.trim() === '/exit') {
      void shutdown();
      return;
    }

    void runtime.adminCommands({
      id: `terminal-admin-${Date.now()}`,
      source: 'terminal',
      sourceId: 'local-console',
      prompt: value,
    }, value).then((response) => {
      if (!response) {
        logger.chat('user', value);
        void runtime.taskQueue.enqueue({
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
        return;
      }

      logger.chat('assistant', response);
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Terminal prompt failed: ${error.message}`);
    });
  });
}

export async function runInitialConsolePrompt(runtime: LocalConsoleRuntime, prompt: string, updateStatus: () => void): Promise<void> {
  const adminResponse = await runtime.adminCommands({
    id: `terminal-admin-${Date.now()}`,
    source: 'terminal',
    sourceId: 'local-console',
    prompt,
  }, prompt);
  if (adminResponse) {
    logger.chat('assistant', adminResponse);
    updateStatus();
    return;
  }

  logger.chat('user', prompt);
  void runtime.taskQueue.enqueue({
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
