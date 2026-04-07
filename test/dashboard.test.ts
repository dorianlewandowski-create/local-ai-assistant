import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/web/dashboard';

test('dashboard server object exposes lifecycle methods', () => {
  const dashboard = createDashboardServer();

  assert.equal(typeof dashboard.start, 'function');
  assert.equal(typeof dashboard.stop, 'function');
  assert.equal(typeof dashboard.getPort, 'function');
});
