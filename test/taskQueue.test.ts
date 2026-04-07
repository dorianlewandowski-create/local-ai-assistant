import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../src/runtime/taskQueue';
import { TaskEnvelope } from '../src/types';

function createTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    source: overrides.source ?? 'terminal',
    sourceId: overrides.sourceId,
    prompt: overrides.prompt ?? 'test',
    metadata: overrides.metadata,
    supplementalSystemPrompt: overrides.supplementalSystemPrompt,
    trackProactiveNotifications: overrides.trackProactiveNotifications,
    timeoutMs: overrides.timeoutMs,
  };
}

test('tasks on different queue keys run concurrently', async () => {
  let active = 0;
  let maxActive = 0;

  const queue = new TaskQueue(async (task) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return { taskId: task.id, source: task.source, agent: 'test', response: task.prompt };
  });

  await Promise.all([
    queue.enqueue(createTask({ id: 'a', source: 'terminal', sourceId: 'one' })),
    queue.enqueue(createTask({ id: 'b', source: 'telegram', sourceId: 'two' })),
  ]);

  assert.equal(maxActive >= 2, true);
});

test('tasks on the same queue key stay serialized', async () => {
  const executionOrder: string[] = [];

  const queue = new TaskQueue(async (task) => {
    executionOrder.push(`start:${task.id}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    executionOrder.push(`end:${task.id}`);
    return { taskId: task.id, source: task.source, agent: 'test', response: task.prompt };
  });

  await Promise.all([
    queue.enqueue(createTask({ id: 'first', source: 'telegram', sourceId: 'chat-1' })),
    queue.enqueue(createTask({ id: 'second', source: 'telegram', sourceId: 'chat-1' })),
  ]);

  assert.deepEqual(executionOrder, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('pending tasks can be cancelled before execution', async () => {
  const queue = new TaskQueue(async (task) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { taskId: task.id, source: task.source, agent: 'test', response: task.prompt };
  });

  const first = queue.enqueue(createTask({ id: 'first', source: 'telegram', sourceId: 'chat-1' }));
  const second = queue.enqueue(createTask({ id: 'second', source: 'telegram', sourceId: 'chat-1' }));
  const secondAssertion = assert.rejects(second, /Task cancelled before execution: second/);
  const cancelled = queue.cancel('second');

  assert.equal(cancelled, true);
  await first;
  await secondAssertion;
});

test('tasks respect timeout limits', async () => {
  const queue = new TaskQueue(async (task) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { taskId: task.id, source: task.source, agent: 'test', response: task.prompt };
  });

  await assert.rejects(
    queue.enqueue(createTask({ id: 'slow', timeoutMs: 10 })),
    /Task timed out after 10ms: slow/
  );
});
