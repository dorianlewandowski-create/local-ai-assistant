import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminCommandHandler } from '../src/runtime/adminCommands';
import { TaskQueue } from '../src/runtime/taskQueue';
import { TaskEnvelope } from '../src/types';
import { sessionStore } from '../src/runtime/sessionStore';

function createTask(prompt: string): TaskEnvelope {
  return {
    id: `admin-${Math.random().toString(36).slice(2, 8)}`,
    source: 'terminal',
    sourceId: 'local-console',
    prompt,
  };
}

function createRemoteTask(prompt: string): TaskEnvelope {
  return {
    id: `admin-remote-${Math.random().toString(36).slice(2, 8)}`,
    source: 'telegram',
    sourceId: 'remote-chat',
    prompt,
  };
}

test('admin commands return queue status', async () => {
  const handler = createAdminCommandHandler({
    taskQueue: new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
  });

  const response = await handler(createTask('/queue'), '/queue');
  assert.match(response || '', /Queue status/);
});

test('admin commands update per-session model', async () => {
  const handler = createAdminCommandHandler({
    taskQueue: new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
  });

  const task = createTask('/model llama3.1:8b');
  const response = await handler(task, '/model llama3.1:8b');
  assert.match(response || '', /llama3.1:8b/);
  assert.equal(sessionStore.getSession(task).settings.model, 'llama3.1:8b');
});

test('non-command input passes through admin handler', async () => {
  const handler = createAdminCommandHandler({
    taskQueue: new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
  });

  const response = await handler(createTask('hello'), 'hello');
  assert.equal(response, null);
});

test('remote sessions cannot change model via admin command', async () => {
  const handler = createAdminCommandHandler({
    taskQueue: new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
  });

  const task = createRemoteTask('/model llama3.1:8b');
  const response = await handler(task, '/model llama3.1:8b');
  assert.match(response || '', /cannot change the model remotely/);
});

test('remote sessions cannot change sandbox mode via admin command', async () => {
  const handler = createAdminCommandHandler({
    taskQueue: new TaskQueue(async (task) => ({ taskId: task.id, source: task.source, agent: 'test', response: 'ok' })),
  });

  const task = createRemoteTask('/sandbox strict');
  const response = await handler(task, '/sandbox strict');
  assert.match(response || '', /cannot change sandbox mode remotely/);
});
