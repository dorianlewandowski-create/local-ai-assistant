import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardServer } from '../src/web/dashboard';
import { createRuntimeApi } from '../src/runtime/api';
import { TaskQueue } from '../src/runtime/taskQueue';
import { runtimeServices } from '../src/runtime/services';

test('dashboard server object exposes lifecycle methods', () => {
  const taskQueue = new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' }));
  const api = createRuntimeApi(
    taskQueue,
    { getPendingApprovalCount: () => 0 },
    runtimeServices,
  );
  const dashboard = createDashboardServer(api);

  assert.equal(typeof dashboard.start, 'function');
  assert.equal(typeof dashboard.stop, 'function');
  assert.equal(typeof dashboard.getPort, 'function');
});
