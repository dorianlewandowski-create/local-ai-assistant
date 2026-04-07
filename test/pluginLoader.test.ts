import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPlugins } from '../src/plugins/loader';

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
