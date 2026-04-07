import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { assessToolRisk } from '../src/security/policy';
import { approveTelegramUser, getPairingStorePath, isTelegramUserPaired } from '../src/security/pairingStore';

test('policy blocks destructive remote operations in remote-safe mode', () => {
  const decision = assessToolRisk('empty_trash', {}, 'telegram');
  assert.equal(decision.allowed, false);
  assert.equal(decision.permissionClass, 'destructive');
});

test('policy requires approval for local automation tools', () => {
  const decision = assessToolRisk('open_app', { appName: 'Safari' }, 'terminal');
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresAuthorization, true);
  assert.equal(decision.permissionClass, 'automation');
});

test('pairing store persists approved telegram users', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-pairing-'));
  const storePath = path.join(tempDir, 'pairings.json');
  process.env.OPENMAC_PAIRING_STORE_PATH = storePath;

  approveTelegramUser('12345');

  assert.equal(getPairingStorePath(), storePath);
  assert.equal(isTelegramUserPaired('12345'), true);

  delete process.env.OPENMAC_PAIRING_STORE_PATH;
});
