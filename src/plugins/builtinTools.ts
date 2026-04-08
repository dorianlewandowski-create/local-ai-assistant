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
import '../tools/soulTools';
import '../tools/skillBuilder';
import '../tools/shortcuts';
import '../tools/appResearch';
import '../tools/transactionTools';
import '../tools/visionControl';
import '../tools/deepWeb';
import '../tools/multiAgent';
import '../tools/modelControl';
import '../skills/garmin/tool';
import '../skills/tech-news/tool';
import '../skills/productivity/tool';
import '../skills/data-analysis/tool';
import '../skills/web-search-plus/tool';
import { PluginManifest } from './types';

export const builtinToolsPlugin: PluginManifest = {
  id: 'builtin-tools',
  description: 'Core built-in OpenMac tool pack',
  register() {
    // Tool modules self-register on import.
  },
};
