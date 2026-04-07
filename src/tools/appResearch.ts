import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

const ResearchAppAutomationParams = z.object({
  appName: z.string().min(1).describe('The name of the application to research (e.g., "Spotify", "Slack").'),
});

export const researchAppAutomation: Tool<typeof ResearchAppAutomationParams> = {
  name: 'research_app_automation',
  description: 'Research how to automate a specific macOS application. It finds the app path and searches for AppleScript or CLI documentation.',
  parameters: ResearchAppAutomationParams,
  execute: async ({ appName }) => {
    try {
      // 1. Find the application path
      logger.debug(`Locating application: ${appName}`);
      const { stdout: pathStdout } = await execAsync(`mdfind "kMDItemKind == 'Application' && kMDItemDisplayName == '${appName}'" | head -n 1`);
      const appPath = pathStdout.trim();

      if (!appPath) {
        return { success: false, error: `Could not find application "${appName}" on this Mac.` };
      }

      // 2. Formulate search queries for the LLM to use with its web_search tool
      const queries = [
        `${appName} AppleScript dictionary commands`,
        `${appName} macOS command line interface documentation`,
        `how to control ${appName} via terminal macOS`,
      ];

      return {
        success: true,
        result: `Application found at: ${appPath}\n\nTo automate this app, I recommend searching for the following:\n${queries.map(q => `- ${q}`).join('\n')}`,
        metadata: { appPath, suggestedQueries: queries }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(researchAppAutomation);
