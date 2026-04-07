import { logger } from '../utils/logger';
import { OpenMacTui } from '../ui/tui';
import { TaskEnvelope } from '../types';

export interface LocalConsoleRuntime {
  runPrompt(prompt: string): Promise<string | null>;
}

export function attachLocalConsole(runtime: LocalConsoleRuntime, tui: OpenMacTui, updateStatus: () => void, shutdown: () => void) {
  tui.onSubmit((value) => {
    if (value.trim() === '/exit') {
      void shutdown();
      return;
    }

    void runtime.runPrompt(value).then((response) => {
      if (response) {
        logger.chat('assistant', response);
      }
      updateStatus();
    }).catch((error: any) => {
      logger.error(`Terminal prompt failed: ${error.message}`);
    });
  });
}

export async function runInitialConsolePrompt(runtime: LocalConsoleRuntime, prompt: string, updateStatus: () => void): Promise<void> {
  const response = await runtime.runPrompt(prompt);
  if (response) {
    logger.chat('assistant', response);
  }
  updateStatus();
}
