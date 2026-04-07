import { logger } from '../utils/logger';
import { AppContext } from '../runtime/appContext';
import { OpenMacTui } from '../ui/tui';

export function attachLocalConsole(appContext: AppContext, tui: OpenMacTui, updateStatus: () => void, shutdown: () => void) {
  tui.onSubmit((value) => {
    if (value.trim() === '/exit') {
      void shutdown();
      return;
    }

    void appContext.adminCommands({
      id: `terminal-admin-${Date.now()}`,
      source: 'terminal',
      sourceId: 'local-console',
      prompt: value,
    }, value).then((response) => {
      if (!response) {
        logger.chat('user', value);
        void appContext.taskQueue.enqueue({
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

export async function runInitialConsolePrompt(appContext: AppContext, prompt: string, updateStatus: () => void): Promise<void> {
  const adminResponse = await appContext.adminCommands({
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
  void appContext.taskQueue.enqueue({
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
