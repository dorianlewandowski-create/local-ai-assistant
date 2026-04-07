import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('channel pairing store approves pending slack pairing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-channel-pairing-'));
  process.env.OPENMAC_CHANNEL_PAIRING_STORE_PATH = path.join(tempDir, 'pairings.json');

  const store = await import('../src/security/channelPairingStore');
  const created = store.getOrCreatePairingCode('slack', 'U123');
  assert.equal(typeof created.code, 'string');
  assert.equal(store.isChannelSubjectApproved('slack', 'U123'), false);

  const approvedSubject = store.approvePairingCode('slack', created.code);
  assert.equal(approvedSubject, 'U123');
  assert.equal(store.isChannelSubjectApproved('slack', 'U123'), true);
  delete process.env.OPENMAC_CHANNEL_PAIRING_STORE_PATH;
});

test('channel pairing store honors configured allowlist without approval record', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-channel-allowlist-'));
  process.env.OPENMAC_CHANNEL_PAIRING_STORE_PATH = path.join(tempDir, 'pairings.json');

  const store = await import('../src/security/channelPairingStore');
  assert.equal(store.isChannelSubjectApproved('whatsapp', '12345@c.us', ['12345@c.us']), true);
  delete process.env.OPENMAC_CHANNEL_PAIRING_STORE_PATH;
});
