import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import * as fs from 'fs/promises'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// --- MKDIR TOOL ---
const MkdirParams = z.object({
  path: z.string().describe('The path of the directory to create'),
})

export const fsMkdir: Tool<typeof MkdirParams> = {
  name: 'fs_mkdir',
  description: 'Create a new directory at the specified path.',
  parameters: MkdirParams,
  execute: async ({ path: targetPath }) => {
    try {
      await fs.mkdir(targetPath, { recursive: true })
      return { success: true, message: `Directory created: ${targetPath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- CP TOOL ---
const CpParams = z.object({
  source: z.string().describe('The source path of the file or directory.'),
  destination: z.string().describe('The target destination path.'),
  recursive: z.boolean().optional().describe('Boolean to indicate recursive copy for directories.'),
})

export const fsCp: Tool<typeof CpParams> = {
  name: 'fs_cp',
  description: 'Copy a file or directory.',
  parameters: CpParams,
  execute: async ({ source, destination, recursive }) => {
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.cp(source, destination, { recursive: recursive ?? false })
      return { success: true, message: `Copied '${source}' to '${destination}'` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- MV TOOL ---
const MvParams = z.object({
  source: z.string().describe('The source path of the file or directory.'),
  destination: z.string().describe('The target destination path.'),
})

export const fsMv: Tool<typeof MvParams> = {
  name: 'fs_mv',
  description: 'Move or rename a file or directory.',
  parameters: MvParams,
  execute: async ({ source, destination }) => {
    try {
      let finalDest = destination
      try {
        const stats = await fs.stat(destination)
        if (stats.isDirectory()) {
          finalDest = path.join(destination, path.basename(source))
        }
      } catch (e) {
        // Destination does not exist, ensure parent exists
        await fs.mkdir(path.dirname(destination), { recursive: true })
      }

      try {
        await fs.rename(source, finalDest)
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          // Cross-device move: copy then remove
          await fs.cp(source, finalDest, { recursive: true })
          await fs.rm(source, { recursive: true, force: true })
        } else {
          throw err
        }
      }
      return { success: true, message: `Moved '${source}' to '${finalDest}'` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- RM TOOL ---
const RmParams = z.object({
  path: z.string().describe('The path of the file or directory to remove'),
})

export const fsRm: Tool<typeof RmParams> = {
  name: 'fs_rm',
  description: 'Remove the file or directory at the specified path.',
  parameters: RmParams,
  execute: async ({ path: targetPath }) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return { success: true, message: `Path removed: ${targetPath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- FIND TOOL ---
const FindParams = z.object({
  dir: z.string().describe('The directory to search in.'),
  name: z.string().optional().describe('A name pattern (e.g., "*config*").'),
  ext: z.string().optional().describe('Comma-separated list of extensions (e.g., "pdf,jpg").'),
})

export const fileFind: Tool<typeof FindParams> = {
  name: 'file_find',
  description: 'Find files by name pattern or extension.',
  parameters: FindParams,
  execute: async ({ dir, name, ext }) => {
    try {
      const results: string[] = []
      const extensions = ext ? ext.split(',').map((e) => e.trim().toLowerCase()) : []

      const matchesPattern = (filename: string, pattern: string) => {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
        return regex.test(filename)
      }

      async function search(currentDir: string, depth: number) {
        if (depth > 2) return
        const entries = await fs.readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullPath = path.join(currentDir, entry.name)

          if (entry.isDirectory()) {
            await search(fullPath, depth + 1)
          } else {
            let matched = true
            if (name && !matchesPattern(entry.name, name)) matched = false
            if (extensions.length > 0) {
              const fileExt = path.extname(entry.name).slice(1).toLowerCase()
              if (!extensions.includes(fileExt)) matched = false
            }
            if (matched) results.push(fullPath)
          }
        }
      }

      await search(dir, 1)
      return { success: true, results }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- ORGANIZE TOOL ---
const OrganizeParams = z.object({
  sourceDir: z.string().describe('The source directory containing files to organize.'),
  targetDir: z.string().describe('The target directory to move files to.'),
  pattern: z.string().optional().describe('Search pattern like "*.pdf" or "screenshot*".'),
  extensions: z.string().optional().describe('Comma-separated list of extensions (e.g., "jpg,png,gif").'),
})

export const fsOrganize: Tool<typeof OrganizeParams> = {
  name: 'fs_organize',
  description: 'Organize files by moving them into target directories based on patterns or extensions.',
  parameters: OrganizeParams,
  execute: async ({ sourceDir, targetDir, pattern, extensions }) => {
    try {
      await fs.mkdir(targetDir, { recursive: true })
      const exts = extensions ? extensions.split(',').map((e) => e.trim().toLowerCase()) : []

      const matchesPattern = (filename: string, p: string) => {
        const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
        return regex.test(filename)
      }

      const entries = await fs.readdir(sourceDir, { withFileTypes: true })
      let movedCount = 0

      for (const entry of entries) {
        if (!entry.isFile()) continue

        let matched = false
        if (pattern && matchesPattern(entry.name, pattern)) matched = true
        else if (exts.length > 0) {
          const fileExt = path.extname(entry.name).slice(1).toLowerCase()
          if (exts.includes(fileExt)) matched = true
        } else if (!pattern && !extensions) {
          matched = true
        }

        if (matched) {
          const src = path.join(sourceDir, entry.name)
          const dest = path.join(targetDir, entry.name)
          await fs.rename(src, dest)
          movedCount++
        }
      }

      return { success: true, message: `Organized ${movedCount} files from '${sourceDir}' to '${targetDir}'` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const EXT_BUCKET: Array<{ folder: string; exts: Set<string> }> = [
  { folder: 'PDFs', exts: new Set(['pdf']) },
  { folder: 'Images', exts: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff']) },
  { folder: 'Video', exts: new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']) },
  { folder: 'Audio', exts: new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']) },
  { folder: 'Archives', exts: new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz']) },
  { folder: 'DiskImages', exts: new Set(['dmg', 'iso']) },
  { folder: 'Documents', exts: new Set(['doc', 'docx', 'txt', 'md', 'rtf', 'pages']) },
  { folder: 'Spreadsheets', exts: new Set(['xls', 'xlsx', 'csv', 'numbers']) },
  { folder: 'Presentations', exts: new Set(['ppt', 'pptx', 'key']) },
  {
    folder: 'Code',
    exts: new Set([
      'ts',
      'tsx',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'py',
      'go',
      'rs',
      'java',
      'swift',
      'kt',
      'rb',
      'php',
      'cs',
      'sql',
      'sh',
      'zsh',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'css',
      'scss',
    ]),
  },
]

function bucketForExtension(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase()
  for (const b of EXT_BUCKET) {
    if (b.exts.has(e)) {
      return b.folder
    }
  }

  return 'Other'
}

const FileOrganizePreviewParams = z.object({
  sourceDir: z.string().describe('Directory to scan (non-recursive: immediate files only).'),
  baseTargetDir: z
    .string()
    .describe(
      'Root folder under which category subfolders will be proposed (e.g. ~/Downloads/Sorted). Nothing is created or moved by this tool.',
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      'Optional glob-style filename pattern (e.g. "screenshot*"). If set, only matching files are included.',
    ),
  extensions: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated extensions (e.g. "pdf,jpg"). If set, only these extensions are included.',
    ),
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Safety cap on files to include in the preview (default 200).'),
})

export type ProposedMove = {
  fileName: string
  from: string
  to: string
  bucket: string
  destinationExists: boolean
}

export const fileOrganizePreview: Tool<typeof FileOrganizePreviewParams> = {
  name: 'file_organize_preview',
  description:
    'Preview how files in a folder could be sorted into extension-based subfolders under a target root — read-only, no moves. Use this before fs_mv/fs_organize so the user can confirm.',
  parameters: FileOrganizePreviewParams,
  manifest: {
    category: 'filesystem',
    riskLevel: 'low',
    permissionClass: 'read',
  },
  execute: async ({ sourceDir, baseTargetDir, pattern, extensions, maxFiles }) => {
    try {
      const cap = maxFiles ?? 200
      const sourceResolved = path.resolve(sourceDir)
      const baseResolved = path.resolve(baseTargetDir)
      const extsFilter = extensions
        ? new Set(
            extensions
              .split(',')
              .map((x) => x.trim().replace(/^\./, '').toLowerCase())
              .filter(Boolean),
          )
        : null

      const matchesPattern = (filename: string, p: string) => {
        const regex = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
        return regex.test(filename)
      }

      const entries = await fs.readdir(sourceResolved, { withFileTypes: true })
      const proposed: ProposedMove[] = []
      const warnings: string[] = []
      const counts: Record<string, number> = {}

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue
        }

        if (pattern && !matchesPattern(entry.name, pattern)) {
          continue
        }

        const ext = path.extname(entry.name).slice(1).toLowerCase()
        if (extsFilter && (!ext || !extsFilter.has(ext))) {
          continue
        }

        const from = path.join(sourceResolved, entry.name)
        const bucket = bucketForExtension(ext)
        const destDir = path.join(baseResolved, bucket)
        const to = path.join(destDir, entry.name)

        counts[bucket] = (counts[bucket] ?? 0) + 1

        let destinationExists = false
        try {
          await fs.access(to)
          destinationExists = true
        } catch {
          destinationExists = false
        }

        proposed.push({
          fileName: entry.name,
          from,
          to,
          bucket,
          destinationExists,
        })

        if (proposed.length >= cap) {
          warnings.push(`Preview truncated after ${cap} files (maxFiles cap).`)
          break
        }
      }

      if (proposed.length === 0) {
        return {
          success: true,
          message: 'No files matched the preview criteria in the source directory.',
          preview: true,
          proposedMoves: [],
          countsByBucket: counts,
          warnings,
        }
      }

      const collisions = proposed.filter((p) => p.destinationExists).length
      if (collisions > 0) {
        warnings.push(
          `${collisions} proposed destination path(s) already exist — moving would require rename or overwrite rules.`,
        )
      }

      const summaryLines = [
        `Preview: ${proposed.length} file(s) from ${sourceResolved}`,
        `→ under ${baseResolved} by category (no changes made).`,
        ...Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `  ${k}: ${v}`),
      ]

      return {
        success: true,
        message: summaryLines.join('\n'),
        preview: true,
        proposedMoves: proposed,
        countsByBucket: counts,
        warnings,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// --- PATCH TOOL ---
const PatchParams = z.object({
  path: z.string().describe('The path of the file to apply to'),
  contents: z.string().describe('The patch to apply to the file'),
})

export const fsPatch: Tool<typeof PatchParams> = {
  name: 'fs_patch',
  description: 'Apply a patch to a file at the specified path.',
  parameters: PatchParams,
  execute: async ({ path: targetPath, contents }) => {
    try {
      await fs.writeFile(targetPath, contents, 'utf-8')
      return { success: true, message: `Patched ${targetPath}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

// Register tools
toolRegistry.register(fsMkdir)
toolRegistry.register(fsCp)
toolRegistry.register(fsMv)
toolRegistry.register(fsRm)
toolRegistry.register(fileFind)
toolRegistry.register(fsOrganize)
toolRegistry.register(fileOrganizePreview)
toolRegistry.register(fsPatch)
