import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';

const execAsync = promisify(exec);

const AppleScriptParams = z.object({
  script: z.string().describe('The AppleScript code to execute'),
});

export const appleScriptRunner: Tool<typeof AppleScriptParams> = {
  name: 'run_applescript',
  description: 'Executes an AppleScript command on macOS and returns the result.',
  parameters: AppleScriptParams,
  execute: async ({ script }) => {
    try {
      // We escape double quotes in the script to safely pass it to osascript -e
      const command = `osascript -e ${JSON.stringify(script)}`;
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        return { success: false, error: stderr.trim() };
      }
      
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Auto-register the tool
toolRegistry.register(appleScriptRunner);
