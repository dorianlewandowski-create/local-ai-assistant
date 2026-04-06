import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- MKDIR TOOL ---
const MkdirParams = z.object({
  path: z.string().describe('The path of the directory to create'),
});

export const fsMkdir: Tool<typeof MkdirParams> = {
  name: 'fs_mkdir',
  description: 'Create a new directory at the specified path.',
  parameters: MkdirParams,
  execute: async ({ path: targetPath }) => {
    try {
      await fs.mkdir(targetPath, { recursive: true });
      return { success: true, message: `Directory created: ${targetPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CP TOOL ---
const CpParams = z.object({
  source: z.string().describe('The source path of the file or directory.'),
  destination: z.string().describe('The target destination path.'),
  recursive: z.boolean().optional().describe('Boolean to indicate recursive copy for directories.'),
});

export const fsCp: Tool<typeof CpParams> = {
  name: 'fs_cp',
  description: 'Copy a file or directory.',
  parameters: CpParams,
  execute: async ({ source, destination, recursive }) => {
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(source, destination, { recursive: recursive ?? false });
      return { success: true, message: `Copied '${source}' to '${destination}'` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- MV TOOL ---
const MvParams = z.object({
  source: z.string().describe('The source path of the file or directory.'),
  destination: z.string().describe('The target destination path.'),
});

export const fsMv: Tool<typeof MvParams> = {
  name: 'fs_mv',
  description: 'Move or rename a file or directory.',
  parameters: MvParams,
  execute: async ({ source, destination }) => {
    try {
      let finalDest = destination;
      try {
        const stats = await fs.stat(destination);
        if (stats.isDirectory()) {
          finalDest = path.join(destination, path.basename(source));
        }
      } catch (e) {
        // Destination does not exist, ensure parent exists
        await fs.mkdir(path.dirname(destination), { recursive: true });
      }
      
      try {
        await fs.rename(source, finalDest);
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          // Cross-device move: copy then remove
          await fs.cp(source, finalDest, { recursive: true });
          await fs.rm(source, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      return { success: true, message: `Moved '${source}' to '${finalDest}'` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- RM TOOL ---
const RmParams = z.object({
  path: z.string().describe('The path of the file or directory to remove'),
});

export const fsRm: Tool<typeof RmParams> = {
  name: 'fs_rm',
  description: 'Remove the file or directory at the specified path.',
  parameters: RmParams,
  execute: async ({ path: targetPath }) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return { success: true, message: `Path removed: ${targetPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- FIND TOOL ---
const FindParams = z.object({
  dir: z.string().describe('The directory to search in.'),
  name: z.string().optional().describe('A name pattern (e.g., "*config*").'),
  ext: z.string().optional().describe('Comma-separated list of extensions (e.g., "pdf,jpg").'),
});

export const fileFind: Tool<typeof FindParams> = {
  name: 'file_find',
  description: 'Find files by name pattern or extension.',
  parameters: FindParams,
  execute: async ({ dir, name, ext }) => {
    try {
      const results: string[] = [];
      const extensions = ext ? ext.split(',').map(e => e.trim().toLowerCase()) : [];
      
      const matchesPattern = (filename: string, pattern: string) => {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return regex.test(filename);
      };

      async function search(currentDir: string, depth: number) {
        if (depth > 2) return;
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            await search(fullPath, depth + 1);
          } else {
            let matched = true;
            if (name && !matchesPattern(entry.name, name)) matched = false;
            if (extensions.length > 0) {
              const fileExt = path.extname(entry.name).slice(1).toLowerCase();
              if (!extensions.includes(fileExt)) matched = false;
            }
            if (matched) results.push(fullPath);
          }
        }
      }

      await search(dir, 1);
      return { success: true, results };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- ORGANIZE TOOL ---
const OrganizeParams = z.object({
  sourceDir: z.string().describe('The source directory containing files to organize.'),
  targetDir: z.string().describe('The target directory to move files to.'),
  pattern: z.string().optional().describe('Search pattern like "*.pdf" or "screenshot*".'),
  extensions: z.string().optional().describe('Comma-separated list of extensions (e.g., "jpg,png,gif").'),
});

export const fsOrganize: Tool<typeof OrganizeParams> = {
  name: 'fs_organize',
  description: 'Organize files by moving them into target directories based on patterns or extensions.',
  parameters: OrganizeParams,
  execute: async ({ sourceDir, targetDir, pattern, extensions }) => {
    try {
      await fs.mkdir(targetDir, { recursive: true });
      const exts = extensions ? extensions.split(',').map(e => e.trim().toLowerCase()) : [];
      
      const matchesPattern = (filename: string, p: string) => {
        const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return regex.test(filename);
      };

      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      let movedCount = 0;

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        
        let matched = false;
        if (pattern && matchesPattern(entry.name, pattern)) matched = true;
        else if (exts.length > 0) {
          const fileExt = path.extname(entry.name).slice(1).toLowerCase();
          if (exts.includes(fileExt)) matched = true;
        } else if (!pattern && !extensions) {
          matched = true;
        }

        if (matched) {
          const src = path.join(sourceDir, entry.name);
          const dest = path.join(targetDir, entry.name);
          await fs.rename(src, dest);
          movedCount++;
        }
      }

      return { success: true, message: `Organized ${movedCount} files from '${sourceDir}' to '${targetDir}'` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CLASSIFY TOOL ---
const ClassifyParams = z.object({
  files: z.string().describe('Comma-separated list of filenames or paths.'),
  contextDirs: z.string().optional().describe('Comma-separated list of potential target directories.'),
});

export const fileClassify: Tool<typeof ClassifyParams> = {
  name: 'file_classify',
  description: 'Classify a list of files to suggest target directories and descriptive names.',
  parameters: ClassifyParams,
  execute: async ({ files, contextDirs }) => {
    try {
      const scriptPath = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools/file_classify.sh';
      let cmd = `${scriptPath} --files "${files}"`;
      if (contextDirs) cmd += ` --context-dirs "${contextDirs}"`;
      
      const { stdout } = await execAsync(cmd);
      // The script might output JSON wrapped in other text or just JSON
      const jsonMatch = stdout.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return { success: true, classification: JSON.parse(jsonMatch[0]) };
      }
      return { success: true, output: stdout };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- PATCH TOOL ---
const PatchParams = z.object({
  path: z.string().describe('The path of the file to apply to'),
  contents: z.string().describe('The patch to apply to the file'),
});

export const fsPatch: Tool<typeof PatchParams> = {
  name: 'fs_patch',
  description: 'Apply a patch to a file at the specified path.',
  parameters: PatchParams,
  execute: async ({ path: targetPath, contents }) => {
    try {
      const scriptPath = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools/fs_patch.sh';
      // Use a temporary file for the patch contents to avoid shell escaping issues
      const tmpPatchPath = path.join('/tmp', `patch-${Date.now()}.diff`);
      await fs.writeFile(tmpPatchPath, contents);
      
      const cmd = `${scriptPath} --path "${targetPath}" --contents "$(cat ${tmpPatchPath})"`;
      
      const { stdout, stderr } = await execAsync(cmd);
      await fs.rm(tmpPatchPath, { force: true });
      return { success: true, message: stdout, stderr };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// Register tools
toolRegistry.register(fsMkdir);
toolRegistry.register(fsCp);
toolRegistry.register(fsMv);
toolRegistry.register(fsRm);
toolRegistry.register(fileFind);
toolRegistry.register(fsOrganize);
toolRegistry.register(fileClassify);
toolRegistry.register(fsPatch);
