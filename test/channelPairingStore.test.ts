import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

test('channel pairing store approves pending slack pairing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-channel-pairing-'))
  process.env.APEX_CHANNEL_PAIRING_STORE_PATH = path.join(tempDir, 'pairings.json')

  const store = await import('@apex/core')
  store.resetPairingRateLimitForTests()
  const created = store.getOrCreatePairingCode('slack', 'U123')
  assert.match(created.code, /^[0-9A-F]{8}$/)
  assert.equal(store.isChannelSubjectApproved('slack', 'U123'), false)

  const approvedSubject = store.approvePairingCode('slack', created.code)
  assert.equal(approvedSubject, 'U123')
  assert.equal(store.isChannelSubjectApproved('slack', 'U123'), true)
  delete process.env.APEX_CHANNEL_PAIRING_STORE_PATH
})

test('channel pairing store rate limits new codes per subject', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-channel-rate-'))
  process.env.APEX_CHANNEL_PAIRING_STORE_PATH = path.join(tempDir, 'pairings.json')

  const store = await import('@apex/core')
  store.resetPairingRateLimitForTests()

  const subject = 'U-RATE-TEST'
  for (let i = 0; i < 8; i++) {
    const c = store.getOrCreatePairingCode('slack', subject)
    assert.ok(c.code.length > 0)
    const approved = store.approvePairingCode('slack', c.code)
    assert.equal(approved, subject)
  }

  assert.throws(() => store.getOrCreatePairingCode('slack', subject), (err: any) => {
    return err?.name === 'PairingRateLimitedError'
  })

  delete process.env.APEX_CHANNEL_PAIRING_STORE_PATH
})

test('channel pairing store honors configured allowlist without approval record', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-channel-allowlist-'))
  process.env.APEX_CHANNEL_PAIRING_STORE_PATH = path.join(tempDir, 'pairings.json')

  const store = await import('@apex/core')
  assert.equal(store.isChannelSubjectApproved('whatsapp', '12345@c.us', ['12345@c.us']), true)
  delete process.env.APEX_CHANNEL_PAIRING_STORE_PATH
})
