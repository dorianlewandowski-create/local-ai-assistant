import { registerPlugins } from '../plugins/loader';
import { builtinToolsPlugin } from '../plugins/builtinTools';

export function registerCoreTools(): void {
  registerPlugins([builtinToolsPlugin]);
}
