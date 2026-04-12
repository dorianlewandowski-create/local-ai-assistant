#!/usr/bin/env node
/**
 * Validates that every JSON file under src/skills/ parses with JSON.parse (strict JSON),
 * matching Node (JSON.parse) and Python (json.load) consumers. See docs/SKILL_JSON_CONTRACT.txt.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillJsonRoot = path.join(root, 'src', 'skills')

function collectJsonFiles(dir, out) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name)
    if (name.isDirectory()) collectJsonFiles(p, out)
    else if (name.name.endsWith('.json')) out.push(p)
  }
}

const files = []
collectJsonFiles(skillJsonRoot, files)
files.sort()

let failed = false
for (const file of files) {
  const rel = path.relative(root, file)
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    failed = true
    console.error(`Invalid JSON: ${rel}`)
    console.error(`  ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (!failed) {
  console.log(`OK: ${files.length} skill JSON file(s) are strict JSON.`)
}

process.exit(failed ? 1 : 0)
