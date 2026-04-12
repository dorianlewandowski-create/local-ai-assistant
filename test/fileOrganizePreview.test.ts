import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileOrganizePreview } from '../src/tools/fsAdvanced'

test('file_organize_preview proposes buckets without moving files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-fop-'))
  fs.writeFileSync(path.join(dir, 'a.pdf'), 'x')
  fs.writeFileSync(path.join(dir, 'b.png'), 'x')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello')
  const base = path.join(dir, 'Sorted')

  const raw = await fileOrganizePreview.execute({
    sourceDir: dir,
    baseTargetDir: base,
  })

  assert.equal(raw.success, true)
  const moves = (raw as { proposedMoves?: { fileName: string; bucket: string; to: string }[] }).proposedMoves
  assert.ok(moves && moves.length === 3)

  const pdf = moves!.find((m) => m.fileName === 'a.pdf')
  assert.equal(pdf?.bucket, 'PDFs')
  assert.ok(pdf?.to.includes(`${path.sep}PDFs${path.sep}a.pdf`))

  assert.equal(fs.existsSync(path.join(dir, 'a.pdf')), true, 'source file must remain in place')
  assert.equal(fs.existsSync(base), false, 'target root must not be created by preview')
})
