import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeApi } from '../src/runtime/api';
import { TaskQueue } from '../src/runtime/taskQueue';
import { runtimeServices } from '../src/runtime/services';

test('runtime api submitPrompt enqueues and returns response', async () => {
  const taskQueue = new TaskQueue(async (task) => ({
    taskId: task.id,
    source: task.source,
    agent: 'test',
    response: `handled:${task.prompt}`,
  }));

  const api = createRuntimeApi(taskQueue, { getPendingApprovalCount: () => 0 }, runtimeServices);
  const response = await api.submitPrompt({
    source: 'terminal',
    sourceId: 'local-console',
    prompt: 'ping',
  });

  assert.equal(response, 'handled:ping');
});
