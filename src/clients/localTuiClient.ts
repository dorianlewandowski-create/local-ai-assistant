import { createTuiClient } from './tuiClient';
import { attachLocalConsole, runInitialConsolePrompt } from './localConsole';
import { LocalRuntimeHostView } from '../runtime/runtimeHost';

export function createLocalTuiClient(runtimeHost: LocalRuntimeHostView, updateStatus: () => void, shutdown: () => void) {
  const { tui, destroy } = createTuiClient();

  return {
    tui,
    attach() {
      attachLocalConsole(runtimeHost.localConsole, tui, updateStatus, shutdown);
      tui.onExit(() => {
        void shutdown();
      });
    },
    async runInitialPrompt(prompt: string) {
      await runInitialConsolePrompt(runtimeHost.localConsole, prompt, updateStatus);
    },
    destroy,
  };
}
