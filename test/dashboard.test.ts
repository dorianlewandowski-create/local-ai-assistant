import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/web/dashboard';
import { TaskQueue } from '../src/runtime/taskQueue';

test('dashboard server object exposes lifecycle methods', () => {
  const dashboard = createDashboardServer(
    new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
    { getPendingApprovalCount: () => 0 },
  );

  assert.equal(typeof dashboard.start, 'function');
  assert.equal(typeof dashboard.stop, 'function');
  assert.equal(typeof dashboard.getPort, 'function');
});
