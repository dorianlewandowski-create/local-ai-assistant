import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionStore } from '../src/runtime/sessionStore';
import { TaskEnvelope } from '../src/types';

function createTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    source: overrides.source ?? 'telegram',
    sourceId: overrides.sourceId ?? 'chat-1',
    prompt: overrides.prompt ?? 'hello',
    metadata: overrides.metadata,
    supplementalSystemPrompt: overrides.supplementalSystemPrompt,
    trackProactiveNotifications: overrides.trackProactiveNotifications,
    timeoutMs: overrides.timeoutMs,
  };
}

test('session store isolates history per session key', () => {
  const first = createTask({ source: 'telegram', sourceId: 'chat-a' });
  const second = createTask({ source: 'telegram', sourceId: 'chat-b' });

  sessionStore.appendInteraction(first, 'hello a', 'reply a');
  sessionStore.appendInteraction(second, 'hello b', 'reply b');

  const firstHistory = sessionStore.formatSessionHistory(first);
  const secondHistory = sessionStore.formatSessionHistory(second);

  assert.match(firstHistory, /hello a/);
  assert.doesNotMatch(firstHistory, /hello b/);
  assert.match(secondHistory, /hello b/);
  assert.doesNotMatch(secondHistory, /hello a/);
});

test('session store keeps aggregated source history across sessions', () => {
  const first = createTask({ source: 'telegram', sourceId: 'chat-source-1' });
  const second = createTask({ source: 'telegram', sourceId: 'chat-source-2' });

  sessionStore.appendInteraction(first, 'source one', 'reply one');
  sessionStore.appendInteraction(second, 'source two', 'reply two');

  const sourceHistory = sessionStore.formatSourceHistory('telegram');
  assert.match(sourceHistory, /source one/);
  assert.match(sourceHistory, /source two/);
});

test('session store supports per-session settings', () => {
  const task = createTask({ source: 'terminal', sourceId: 'local-console-session' });
  const settings = sessionStore.updateSessionSettings(task, { verbosity: 'high', approvalMode: 'strict' });

  assert.equal(settings.verbosity, 'high');
  assert.equal(settings.approvalMode, 'strict');
  assert.equal(sessionStore.getSession(task).settings.verbosity, 'high');
});
