import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCliCommand } from '../src/cli';
import { buildLaunchdPlist } from '../src/launchd';

test('cli resolves onboarding and packaging commands', () => {
  assert.deepEqual(resolveCliCommand(['onboard']), { command: 'onboard', argv: [] });
  assert.deepEqual(resolveCliCommand(['launchd-install']), { command: 'launchd-install', argv: [] });
  assert.deepEqual(resolveCliCommand(['update']), { command: 'update', argv: [] });
  assert.deepEqual(resolveCliCommand(['release-pack']), { command: 'release-pack', argv: [] });
  assert.deepEqual(resolveCliCommand(['pairing', 'list', 'slack']), { command: 'pairing', argv: ['list', 'slack'] });
});

test('launchd plist contains expected openmac label', () => {
  const plist = buildLaunchdPlist('/tmp/openmac');
  assert.match(plist, /ai\.openmac\.agent/);
  assert.match(plist, /\/tmp\/openmac\/bin\/run\.sh/);
});
