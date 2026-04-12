import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRuntimePromptBody } from '../src/runtime/runtimePromptBody'

test('parseRuntimePromptBody accepts gateway-shaped payloads', () => {
  const r = parseRuntimePromptBody({
    source: 'telegram',
    sourceId: 'chat-1',
    prompt: 'hi',
  })
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.value.source, 'telegram')
  assert.equal(r.value.sourceId, 'chat-1')
})

test('parseRuntimePromptBody defaults terminal sourceId', () => {
  const r = parseRuntimePromptBody({
    source: 'terminal',
    prompt: 'hi',
  })
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.value.sourceId, 'local-console')
})

test('parseRuntimePromptBody rejects unknown source', () => {
  const r = parseRuntimePromptBody({
    source: 'not-a-source',
    sourceId: 'x',
    prompt: 'hi',
  })
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
})
