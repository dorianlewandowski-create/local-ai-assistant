import { z } from 'zod';
import { Tool } from '../../types';
import { toolRegistry } from '../../tools/registry';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const SKILL_DIR = path.join(process.cwd(), 'src', 'skills', 'garmin');

const GetGarminStatsParams = z.object({});

export const getGarminStats: Tool<typeof GetGarminStatsParams> = {
  name: 'get_garmin_stats',
  description: 'Fetch today\'s Garmin health stats (body battery, sleep, recovery).',
  parameters: GetGarminStatsParams,
  execute: async () => {
    try {
      const { stdout } = await execAsync(`bash "${path.join(SKILL_DIR, 'scripts', 'get-stats.sh')}"`);
      return { success: true, result: stdout };
    } catch (error: any) {
      return { success: false, error: `Garmin fetch failed. Ensure 'garminconnect' is installed and credentials are in macOS Keychain. Error: ${error.message}` };
    }
  },
};

const GetGarminSummaryParams = z.object({});

export const getGarminSummary: Tool<typeof GetGarminSummaryParams> = {
  name: 'get_garmin_morning_summary',
  description: 'Fetch a formatted morning summary of your health and recovery status.',
  parameters: GetGarminSummaryParams,
  execute: async () => {
    try {
      const { stdout } = await execAsync(`bash "${path.join(SKILL_DIR, 'scripts', 'morning-summary.sh')}"`);
      return { success: true, result: stdout };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(getGarminStats);
toolRegistry.register(getGarminSummary);
