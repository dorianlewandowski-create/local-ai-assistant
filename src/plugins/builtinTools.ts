import '../tools/macControl';
import '../tools/fileSystem';
import '../tools/reminders';
import '../tools/browser';
import '../tools/calendar';
import '../tools/fsAdvanced';
import '../tools/webSearch';
import '../tools/systemMisc';
import '../tools/memory';
import '../tools/fileContent';
import { PluginManifest } from './types';

export const builtinToolsPlugin: PluginManifest = {
  id: 'builtin-tools',
  description: 'Core built-in OpenMac tool pack',
  register() {
    // Tool modules self-register on import.
  },
};
