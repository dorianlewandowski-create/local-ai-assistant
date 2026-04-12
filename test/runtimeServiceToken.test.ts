import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureRuntimeServiceTokenWithMeta,
  timingSafeEqualString,
} from '../src/runtime/runtimeServiceToken'

test('timingSafeEqualString accepts equal secrets', () => {
  const a = crypto.randomBytes(16).toString('hex')
  assert.equal(timingSafeEqualString(a, a), true)
})

test('timingSafeEqualString rejects different lengths', () => {
  assert.equal(timingSafeEqualString('a', 'ab'), false)
})

test('timingSafeEqualString rejects different values same length', () => {
  assert.equal(timingSafeEqualString('same-len-aaaaaa', 'same-len-bbbbbb'), false)
})

test('ensureRuntimeServiceTokenWithMeta creates once then reuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-token-meta-'))
  const prev = process.env.APEX_STATE_DIR
  process.env.APEX_STATE_DIR = dir
  try {
    const a = ensureRuntimeServiceTokenWithMeta()
    assert.equal(a.createdNew, true)
    assert.ok(a.token.length > 8)
    const b = ensureRuntimeServiceTokenWithMeta()
    assert.equal(b.createdNew, false)
    assert.equal(b.token, a.token)
  } finally {
    if (prev === undefined) {
      delete process.env.APEX_STATE_DIR
    } else {
      process.env.APEX_STATE_DIR = prev
    }
  }
})
