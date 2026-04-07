import { z } from 'zod';
import { Tool } from '../../types';
import { toolRegistry } from '../../tools/registry';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';

const PRODUCTIVITY_DIR = path.join(process.cwd(), 'data', 'productivity');

const CaptureParams = z.object({
  content: z.string().min(1).describe('The thought, task, or idea to capture.'),
});

export const productivityCapture: Tool<typeof CaptureParams> = {
  name: 'productivity_capture',
  description: 'Quickly capture a thought, task, or idea into your productivity inbox.',
  parameters: CaptureParams,
  execute: async ({ content }: { content: string }) => {
    try {
      const inboxPath = path.join(PRODUCTIVITY_DIR, 'inbox', 'capture.md');
      const entry = `- [ ] ${content} (Captured: ${new Date().toLocaleString()})\n`;
      await fs.appendFile(inboxPath, entry);
      return { success: true, result: 'Saved to inbox.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const GetDashboardParams = z.object({});

export const productivityGetDashboard: Tool<typeof GetDashboardParams> = {
  name: 'productivity_get_dashboard',
  description: 'Retrieve your current productivity dashboard, including active goals and top tasks.',
  parameters: GetDashboardParams,
  execute: async () => {
    try {
      const dashboardPath = path.join(PRODUCTIVITY_DIR, 'dashboard.md');
      if (!(await fs.access(dashboardPath).then(() => true).catch(() => false))) {
        return { success: true, result: 'Dashboard not initialized. Use productivity_capture to start.' };
      }
      const content = await fs.readFile(dashboardPath, 'utf-8');
      return { success: true, result: content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const UpdateTaskParams = z.object({
  type: z.enum(['next-actions', 'this-week', 'done']),
  content: z.string().min(1).describe('The full updated content for the task list.'),
});

export const productivityUpdateTask: Tool<typeof UpdateTaskParams> = {
  name: 'productivity_update_task',
  description: 'Update one of your task lists (next-actions, this-week, or done).',
  parameters: UpdateTaskParams,
  execute: async ({ type, content }: { type: 'next-actions' | 'this-week' | 'done', content: string }) => {
    try {
      const taskPath = path.join(PRODUCTIVITY_DIR, 'tasks', `${type}.md`);
      await fs.writeFile(taskPath, content);
      return { success: true, result: `Updated ${type} list.` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(productivityCapture);
toolRegistry.register(productivityGetDashboard);
toolRegistry.register(productivityUpdateTask);
