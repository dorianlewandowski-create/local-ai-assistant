import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { soulStore } from '../runtime/soulStore';

const UpdateSoulParams = z.object({
  content: z.string().min(1, 'Content is required.').describe('The full new content for the HOT memory (memory.md).'),
});

export const updateSoul: Tool<typeof UpdateSoulParams> = {
  name: 'update_soul',
  description: 'Update your persistent HOT memory (identity and confirmed preferences). Use this when a pattern is confirmed or a major preference changes.',
  parameters: UpdateSoulParams,
  execute: async ({ content }) => {
    try {
      await soulStore.save(content);
      return { success: true, result: 'HOT memory updated successfully.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const LogCorrectionParams = z.object({
  context: z.string().describe('The context of the error (e.g., "Spotify control").'),
  correction: z.string().describe('What was corrected by the user or identified as wrong.'),
});

export const logCorrection: Tool<typeof LogCorrectionParams> = {
  name: 'log_correction',
  description: 'Log a correction to your memory. Use this whenever the user says "No, do X instead" or points out a mistake.',
  parameters: LogCorrectionParams,
  execute: async ({ context, correction }) => {
    try {
      await soulStore.logCorrection(context, correction);
      return { success: true, result: 'Correction logged.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const LogReflectionParams = z.object({
  context: z.string().describe('The task context.'),
  reflection: z.string().describe('What you noticed about your performance.'),
  lesson: z.string().describe('The lesson learned for next time.'),
});

export const logReflection: Tool<typeof LogReflectionParams> = {
  name: 'log_reflection',
  description: 'Log a self-reflection after completing a significant task. Helps in compounding knowledge.',
  parameters: LogReflectionParams,
  execute: async ({ context, reflection, lesson }) => {
    try {
      await soulStore.logReflection(context, reflection, lesson);
      return { success: true, result: 'Reflection logged.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(updateSoul);
toolRegistry.register(logCorrection);
toolRegistry.register(logReflection);
