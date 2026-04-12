import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveCliCommand } from '../src/index'
import { runFilesCli } from '../src/filesPreviewCli'

test('resolveCliCommand maps apex help and files', () => {
  assert.deepEqual(resolveCliCommand(['help']), { command: 'help', argv: [] })
  assert.deepEqual(resolveCliCommand(['--help']), { command: 'help', argv: [] })
  assert.deepEqual(resolveCliCommand(['-h']), { command: 'help', argv: [] })

  const r = resolveCliCommand(['files', 'preview', '/tmp/a', '/tmp/b'])
  assert.equal(r.command, 'files')
  assert.deepEqual(r.argv, ['preview', '/tmp/a', '/tmp/b'])
})

test('runFilesCli preview exits 0 and prints JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-fcli-'))
  fs.writeFileSync(path.join(dir, 'a.pdf'), 'x')
  const base = path.join(dir, 'Sorted')

  const lines: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  console.error = () => {}
  try {
    const code = await runFilesCli(['preview', dir, base, '--json'])
    assert.equal(code, 0)
    const parsed = JSON.parse(lines.join('\n')) as { success?: boolean; proposedMoves?: unknown[] }
    assert.equal(parsed.success, true)
    assert.ok(Array.isArray(parsed.proposedMoves) && parsed.proposedMoves!.length === 1)
  } finally {
    console.log = origLog
    console.error = origErr
  }
})

test('runFilesCli rejects unknown subcommand', async () => {
  const origErr = console.error
  const origLog = console.log
  console.error = () => {}
  console.log = () => {}
  try {
    const code = await runFilesCli(['nope'])
    assert.equal(code, 1)
  } finally {
    console.error = origErr
    console.log = origLog
  }
})

test('runFilesCli with no args prints files help and exits 0', async () => {
  const origLog = console.log
  console.log = () => {}
  try {
    const code = await runFilesCli([])
    assert.equal(code, 0)
  } finally {
    console.log = origLog
  }
})

test('runFilesCli preview --help exits 0 without paths', async () => {
  const origLog = console.log
  console.log = () => {}
  try {
    const code = await runFilesCli(['preview', '--help'])
    assert.equal(code, 0)
  } finally {
    console.log = origLog
  }
})
