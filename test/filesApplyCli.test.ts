import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { allocateUniqueDestination, runFilesApplyCli } from '../src/filesApplyCli'

test('allocateUniqueDestination picks suffix when preferred exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-alloc-'))
  const preferred = path.join(dir, 'a.pdf')
  fs.writeFileSync(preferred, 'x')
  const reserved = new Set<string>()
  const got = await allocateUniqueDestination(preferred, reserved)
  assert.equal(got, path.join(dir, 'a (1).pdf'))
  assert.equal(reserved.has(got), true)
})

test('runFilesApplyCli moves files with --yes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-apply-'))
  const srcDir = path.join(root, 'In')
  const base = path.join(root, 'Sorted')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'x.pdf'), 'pdf')

  const logs: string[] = []
  const errs: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a: unknown[]) => logs.push(a.join(' '))
  console.error = (...a: unknown[]) => errs.push(a.join(' '))
  try {
    const code = await runFilesApplyCli([srcDir, base, '--yes'])
    assert.equal(code, 0)
    assert.equal(fs.existsSync(path.join(srcDir, 'x.pdf')), false)
    assert.equal(fs.existsSync(path.join(base, 'PDFs', 'x.pdf')), true)
    assert.ok(logs.some((l) => l.includes('moved:') && l.includes('x.pdf')))
  } finally {
    console.log = origLog
    console.error = origErr
  }
})

test('runFilesApplyCli dry-run does not move', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-dry-'))
  const srcDir = path.join(root, 'In')
  const base = path.join(root, 'Sorted')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'y.pdf'), 'pdf')

  const origLog = console.log
  const origErr = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    const code = await runFilesApplyCli([srcDir, base, '--dry-run'])
    assert.equal(code, 0)
    assert.equal(fs.existsSync(path.join(srcDir, 'y.pdf')), true)
    assert.equal(fs.existsSync(path.join(base, 'PDFs', 'y.pdf')), false)
  } finally {
    console.log = origLog
    console.error = origErr
  }
})

test('runFilesApplyCli refuses without --yes or --dry-run', async () => {
  const origErr = console.error
  const origLog = console.log
  console.error = () => {}
  console.log = () => {}
  try {
    const code = await runFilesApplyCli(['/tmp/a', '/tmp/b'])
    assert.equal(code, 1)
  } finally {
    console.error = origErr
    console.log = origLog
  }
})
