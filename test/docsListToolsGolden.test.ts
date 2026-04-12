import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

/**
 * Golden output for `npm run docs:list-tools` (scripts/list-tools.mjs).
 * When you add/remove/rename tools, refresh the file:
 *   node scripts/list-tools.mjs > docs/tools-list.golden.txt
 * Then commit the updated golden.
 */
test('docs:list-tools output matches docs/tools-list.golden.txt', () => {
  const goldenPath = path.join(ROOT, 'docs', 'tools-list.golden.txt')
  const scriptPath = path.join(ROOT, 'scripts', 'list-tools.mjs')

  const expected = fs.readFileSync(goldenPath, 'utf8').replace(/\r\n/g, '\n')
  const actual = execFileSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  }).replace(/\r\n/g, '\n')

  assert.equal(
    actual,
    expected,
    'docs:list-tools drifted from golden. Refresh: node scripts/list-tools.mjs > docs/tools-list.golden.txt',
  )
})
