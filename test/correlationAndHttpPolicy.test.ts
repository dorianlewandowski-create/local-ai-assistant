import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newCorrelationId } from '../src/utils/correlationId'
import { OllamaCircuitBreaker } from '../src/runtime/ollamaCircuitBreaker'

test('newCorrelationId returns req- prefix and hex suffix', () => {
  const id = newCorrelationId()
  assert.match(id, /^req-[0-9a-f]{12}$/)
})

test('OllamaCircuitBreaker opens after 3 failures in window', () => {
  const cb = new OllamaCircuitBreaker({
    failWindowMs: 60_000,
    failuresToOpen: 3,
    openDurationMs: 60_000,
  })
  assert.equal(cb.snapshot().state, 'closed')
  cb.preflight()
  cb.recordFailure()
  cb.recordFailure()
  assert.equal(cb.snapshot().state, 'closed')
  cb.recordFailure()
  assert.equal(cb.snapshot().state, 'open')
})
