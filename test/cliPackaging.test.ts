import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCliCommand } from '../src/index';
import { buildLaunchdPlist } from '../src/launchd';

test('cli resolves onboarding and packaging commands', () => {
  assert.deepEqual(resolveCliCommand(['onboard']), { command: 'onboard', argv: [] });
  assert.deepEqual(resolveCliCommand(['launchd-install']), { command: 'launchd-install', argv: [] });
  assert.deepEqual(resolveCliCommand(['service-status']), { command: 'service-status', argv: [] });
  assert.deepEqual(resolveCliCommand(['service-safe', 'on']), { command: 'service-safe', argv: ['on'] });
  assert.deepEqual(resolveCliCommand(['service-model', 'telegram', 'chat-1', 'foo']), { command: 'service-model', argv: ['telegram', 'chat-1', 'foo'] });
  assert.deepEqual(resolveCliCommand(['service-sandbox', 'telegram', 'chat-1', 'strict']), { command: 'service-sandbox', argv: ['telegram', 'chat-1', 'strict'] });
  assert.deepEqual(resolveCliCommand(['service-approvals']), { command: 'service-approvals', argv: [] });
  assert.deepEqual(resolveCliCommand(['service-approve', 'abc']), { command: 'service-approve', argv: ['abc'] });
  assert.deepEqual(resolveCliCommand(['service-deny', 'abc']), { command: 'service-deny', argv: ['abc'] });
  assert.deepEqual(resolveCliCommand(['service-sessions']), { command: 'service-sessions', argv: [] });
  assert.deepEqual(resolveCliCommand(['update']), { command: 'update', argv: [] });
  assert.deepEqual(resolveCliCommand(['release-pack']), { command: 'release-pack', argv: [] });
  assert.deepEqual(resolveCliCommand(['release-verify']), { command: 'release-verify', argv: [] });
  assert.deepEqual(resolveCliCommand(['pairing', 'list', 'slack']), { command: 'pairing', argv: ['list', 'slack'] });
});

test('launchd plist contains expected openmac label', () => {
  const plist = buildLaunchdPlist('/tmp/openmac');
  assert.match(plist, /ai\.openmac\.agent/);
  assert.match(plist, /\/tmp\/openmac\/bin\/run\.sh/);
});
