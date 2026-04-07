import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverExternalPlugins, registerPlugins } from '../src/plugins/loader';

test('plugin loader registers plugin manifests', () => {
  let called = 0;
  registerPlugins([
    {
      id: 'test-plugin',
      description: 'test',
      register() {
        called += 1;
      },
    },
  ]);

  assert.equal(called, 1);
});

test('plugin loader discovers valid external plugins', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-plugins-'));
  const pluginRoot = path.join(pluginDir, 'sample');
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'openmac-plugin.json'), JSON.stringify({
    id: 'sample-plugin',
    description: 'Sample plugin',
    main: 'index.js',
  }));
  fs.writeFileSync(path.join(pluginRoot, 'index.js'), 'exports.register = () => {};');

  const plugins = discoverExternalPlugins(pluginDir);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0]?.id, 'sample-plugin');
});

test('plugin loader skips invalid plugin manifests safely', () => {
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmac-plugins-invalid-'));
  const pluginRoot = path.join(pluginDir, 'bad');
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'openmac-plugin.json'), JSON.stringify({
    id: '../bad',
    description: 'Bad plugin',
    main: '../index.js',
  }));

  const plugins = discoverExternalPlugins(pluginDir);
  assert.equal(plugins.length, 0);
});
