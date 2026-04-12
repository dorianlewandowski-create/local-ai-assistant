import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkRemoteResponse, formatRemoteAssistantText } from '../src/gateways/responseFormatting'

test('remote response chunking preserves short responses', () => {
  assert.deepEqual(chunkRemoteResponse('hello', 10), ['hello'])
})

test('remote response chunking splits large responses', () => {
  const chunks = chunkRemoteResponse('a'.repeat(25), 10)
  assert.equal(chunks.length > 1, true)
  assert.equal(chunks.join(''), 'a'.repeat(25))
})

test('remote response formatting trims text', () => {
  assert.equal(formatRemoteAssistantText('  hello world  '), 'hello world')
})
