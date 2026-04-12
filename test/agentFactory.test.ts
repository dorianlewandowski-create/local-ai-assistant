import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentFactory } from '../src/agent/factory'

test('AgentFactory.choose respects metadata.subAgentKind', () => {
  const f = new AgentFactory('m', [])
  assert.equal(f.choose('build a typescript api', { subAgentKind: 'researcher' }), 'researcher')
  assert.equal(f.choose('ignore this text for routing', { subAgentKind: 'coder' }), 'coder')
  assert.equal(f.choose('sudo rm -rf /', { subAgentKind: 'system' }), 'system')
})

test('AgentFactory.choose falls back to heuristics when no override', () => {
  const f = new AgentFactory('m', [])
  assert.equal(f.choose('fix the typescript build error', {}), 'coder')
  assert.equal(f.choose('summarize this pdf', {}), 'researcher')
  assert.equal(f.choose('open Spotify', {}), 'system')
})
