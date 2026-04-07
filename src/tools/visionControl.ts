import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';

const execAsync = promisify(exec);

const VisionGetScreenSnapshotParams = z.object({
  query: z.string().min(1).describe('What you are looking for on the screen (e.g., "Find the Send button", "Describe the current window").'),
});

export const visionGetScreenSnapshot: Tool<typeof VisionGetScreenSnapshotParams> = {
  name: 'vision_get_screen_snapshot',
  description: 'Take a screenshot and analyze it using a multimodal AI model. Use this to find UI elements that are not accessible via AppleScript.',
  parameters: VisionGetScreenSnapshotParams,
  execute: async ({ query }) => {
    const screenshotPath = path.join(process.cwd(), 'data', 'vision_input.png');
    try {
      // 1. Capture screen
      await execAsync(`screencapture -x "${screenshotPath}"`);
      
      // 2. Read file as base64
      const imageBuffer = await fs.readFile(screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      // 3. Call Ollama with multimodal model
      // Note: We use the configured Ollama host and a multimodal model (llava by default)
      const response = await fetch(`${config.ollama.host}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({
          model: 'llava', // Standard multimodal model in Ollama
          prompt: `${query}\nPlease provide your response. If you are identifying coordinates, try to estimate them in {x, y} format for a standard 1440x900 screen if possible.`,
          images: [base64Image],
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama vision request failed: ${response.statusText}`);
      }

      const data: any = await response.json();
      return { 
        success: true, 
        result: data.response,
        metadata: { screenshotPath } 
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      // We keep the last screenshot for debugging but could delete it
    }
  },
};

const VisionClickAtParams = z.object({
  x: z.number().describe('Horizontal coordinate.'),
  y: z.number().describe('Vertical coordinate.'),
});

export const visionClickAt: Tool<typeof VisionClickAtParams> = {
  name: 'vision_click_at',
  description: 'Perform a mouse click at the specified screen coordinates. Use vision_get_screen_snapshot first to find coordinates.',
  parameters: VisionClickAtParams,
  execute: async ({ x, y }) => {
    try {
      await execAsync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`);
      return { success: true, result: `Clicked at {${x}, ${y}}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(visionGetScreenSnapshot);
toolRegistry.register(visionClickAt);
