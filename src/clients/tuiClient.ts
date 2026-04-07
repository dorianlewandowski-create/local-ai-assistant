import { OpenMacTui } from '../ui/tui';

export function createTuiClient() {
  const tui = new OpenMacTui();

  return {
    tui,
    destroy() {
      tui.destroy();
    },
  };
}
