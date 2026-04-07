import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, resolveConfigPath } from '../src/config';
import { resolveCliCommand } from '../src/index';

test('config exposes default watcher directories', () => {
  const config = loadConfig({ env: {} });
  assert.ok(Array.isArray(config.watcher.directories));
  assert.ok(config.watcher.directories.length >= 2);
});

test('config exposes watcher extensions as lowercase set', () => {
  const config = loadConfig({ env: {} });
  assert.equal(config.watcher.extensions.has('.pdf'), true);
  assert.equal(config.watcher.extensions.has('.jpg'), true);
});

test('config loads openmac.json and allows env overrides', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-config-'));
  fs.writeFileSync(path.join(tempDir, 'openmac.json'), JSON.stringify({
    models: { chat: 'file-model' },
    watcher: { directories: ['~/Inbox'] },
    gateways: { telegram: { enabled: true } },
  }));

  const config = loadConfig({
    cwd: tempDir,
    env: {
      OLLAMA_MODEL: 'env-model',
      OPENMAC_WATCH_EXTENSIONS: '.pdf,.docx',
    },
  });

  assert.equal(config.models.chat, 'env-model');
  assert.equal(config.gateways.telegram.enabled, true);
  assert.equal(config.meta.configPath, path.join(tempDir, 'openmac.json'));
  assert.equal(config.watcher.directories[0].endsWith(path.join('', 'Inbox')), true);
  assert.equal(config.watcher.extensions.has('.docx'), true);
});

test('resolveConfigPath respects OPENMAC_CONFIG', () => {
  const resolved = resolveConfigPath('/tmp/project', { OPENMAC_CONFIG: './config/openmac.json' });
  assert.equal(resolved, '/tmp/project/config/openmac.json');
});

test('cli resolves doctor command separately from runtime prompts', () => {
  assert.deepEqual(resolveCliCommand(['doctor']), { command: 'doctor', argv: [] });
  assert.deepEqual(resolveCliCommand(['open', 'Safari']), { command: 'run', argv: ['open', 'Safari'] });
});
