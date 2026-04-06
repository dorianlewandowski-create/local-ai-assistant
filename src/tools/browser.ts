import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- CHROME ACTIVE TAB TOOL ---
const BrowserParams = z.object({});

export const browserChromeActiveTab: Tool<typeof BrowserParams> = {
  name: 'browser_chrome_active_tab',
  description: 'Get the title and URL of the active tab in Google Chrome.',
  parameters: BrowserParams,
  execute: async () => {
    try {
      const script = `
        tell application "Google Chrome"
          if count of windows is 0 then
            return "Google Chrome is not running or has no windows open."
          end if
          set current_url to URL of active tab of front window
          set current_title to title of active tab of front window
          return current_title & " | " & current_url
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SAFARI ACTIVE TAB TOOL ---
export const browserSafariActiveTab: Tool<typeof BrowserParams> = {
  name: 'browser_safari_active_tab',
  description: 'Get the title and URL of the active tab in Safari.',
  parameters: BrowserParams,
  execute: async () => {
    try {
      const script = `
        tell application "Safari"
          if count of windows is 0 then
            return "Safari is not running or has no windows open."
          end if
          set current_url to URL of front document
          set current_title to name of front document
          return current_title & " | " & current_url
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Register tools
toolRegistry.register(browserChromeActiveTab);
toolRegistry.register(browserSafariActiveTab);
