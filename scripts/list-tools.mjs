#!/usr/bin/env node
// Machine-readable inventory of tool names from source (no toolRegistry boot).
// Usage: npm run docs:list-tools
// Sections: core (src/tools), skills (per-skill tool.ts), ScreenControl manifest.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

/** @param {string} dir */
function walkFiles(dir) {
  /** @type {string[]} */
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'venv') continue
      out.push(...walkFiles(p))
    } else {
      out.push(p)
    }
  }
  return out
}

/** @param {string} filePath */
function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

/**
 * Tool definitions use `name: 'tool_id'` (single line in practice).
 * @param {string} source
 * @returns {string[]}
 */
function extractToolNames(source) {
  const names = []
  const re = /name:\s*['"]([a-zA-Z0-9_]+)['"]/g
  let m
  while ((m = re.exec(source)) !== null) {
    names.push(m[1])
  }
  return names
}

/**
 * @param {string[]} files
 * @param {(s: string) => boolean} [filter]
 */
function collectNamesFromTsFiles(files, filter = () => true) {
  const set = new Set()
  for (const f of files) {
    if (!f.endsWith('.ts')) continue
    if (!filter(f)) continue
    for (const n of extractToolNames(readText(f))) {
      set.add(n)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

function main() {
  const toolsDir = path.join(ROOT, 'src', 'tools')
  const toolFiles = walkFiles(toolsDir).filter((f) => f.endsWith('.ts'))

  const skillsRoot = path.join(ROOT, 'src', 'skills')
  const skillToolFiles = walkFiles(skillsRoot).filter((f) => f.endsWith(`${path.sep}tool.ts`))

  const coreNames = collectNamesFromTsFiles(toolFiles)
  const skillNames = collectNamesFromTsFiles(skillToolFiles)

  /** @type {{ name: string, tools?: { name: string }[] }} */
  let manifest
  const manifestPath = path.join(ROOT, 'src', 'plugins', 'ScreenControl', 'manifest.json')
  try {
    manifest = JSON.parse(readText(manifestPath))
  } catch (e) {
    console.error(`[list-tools] Failed to parse ${manifestPath}: ${e?.message ?? e}`)
    manifest = { name: 'ScreenControl', tools: [] }
  }
  const pluginId = String(manifest.name ?? 'ScreenControl')
  const pluginTools = (manifest.tools ?? [])
    .map((t) => `${pluginId}.${t.name}`)
    .sort((a, b) => a.localeCompare(b))

  const out = []
  out.push('--- core (src/tools) ---')
  for (const n of coreNames) out.push(n)
  out.push('')
  out.push('--- skills (src/skills/*/tool.ts) ---')
  for (const n of skillNames) out.push(n)
  out.push('')
  out.push(`--- sdk plugin (${path.relative(ROOT, manifestPath)}) ---`)
  for (const n of pluginTools) out.push(n)
  out.push('')
  out.push(`--- counts ---`)
  out.push(`core: ${coreNames.length}`)
  out.push(`skills: ${skillNames.length}`)
  out.push(`plugin: ${pluginTools.length}`)

  process.stdout.write(`${out.join('\n')}\n`)
}

main()
