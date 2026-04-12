import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTraceId } from '../core/brain/src/observability'

test('resolveTraceId prefers metadata.correlationId', () => {
  assert.equal(
    resolveTraceId({
      id: 'task-1',
      source: 'terminal',
      prompt: 'hi',
      metadata: { correlationId: 'req-abc123' },
    }),
    'req-abc123',
  )
})

test('resolveTraceId falls back to task.id', () => {
  assert.equal(
    resolveTraceId({
      id: 'task-2',
      source: 'terminal',
      prompt: 'hi',
    }),
    'task-2',
  )
})
