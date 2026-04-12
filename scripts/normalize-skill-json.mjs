#!/usr/bin/env node
/**
 * One-off / maintainer helper: parse bundled skill JSON with JSON5 (trailing commas, etc.)
 * and rewrite strict RFC 8259 JSON so Node JSON.parse and Python json.load agree.
 *
 * See docs/SKILL_JSON_CONTRACT.txt. Prefer editing skill JSON as strict JSON; run this
 * after importing relaxed snippets.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import JSON5 from 'json5'

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

let changed = 0
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8')
  const data = JSON5.parse(raw)
  const next = `${JSON.stringify(data, null, 2)}\n`
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8')
    changed += 1
    console.log(`normalized ${path.relative(root, file)}`)
  }
}

console.log(`Done. ${changed} file(s) updated, ${files.length} total.`)
