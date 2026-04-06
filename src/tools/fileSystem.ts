import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import * as fs from 'fs/promises';
import * as path from 'path';

// --- LS TOOL ---
const LsParams = z.object({
  path: z.string().describe('The path of the directory to list'),
});

export const fsLs: Tool<typeof LsParams> = {
  name: 'fs_ls',
  description: 'List all files and directories at the specified path.',
  parameters: LsParams,
  execute: async ({ path: targetPath }) => {
    try {
      const files = await fs.readdir(targetPath);
      return { success: true, files };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CAT TOOL ---
const CatParams = z.object({
  path: z.string().describe('The path of the file to read'),
});

export const fsCat: Tool<typeof CatParams> = {
  name: 'fs_cat',
  description: 'Read the contents of a file at the specified path.',
  parameters: CatParams,
  execute: async ({ path: targetPath }) => {
    try {
      const contents = await fs.readFile(targetPath, 'utf-8');
      return { success: true, contents };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- WRITE TOOL ---
const WriteParams = z.object({
  path: z.string().describe('The path of the file to write to'),
  contents: z.string().describe('The full contents to write to the file'),
});

export const fsWrite: Tool<typeof WriteParams> = {
  name: 'fs_write',
  description: 'Write the full file contents to a file at the specified path.',
  parameters: WriteParams,
  execute: async ({ path: targetPath, contents }) => {
    try {
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(targetPath, contents, 'utf-8');
      return { success: true, message: `Successfully wrote to ${targetPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Register tools
toolRegistry.register(fsLs);
toolRegistry.register(fsCat);
toolRegistry.register(fsWrite);
