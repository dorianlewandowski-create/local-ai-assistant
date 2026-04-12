import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { config } from '@apex/core'
import { assessToolRisk } from '../src/security/policy'
import { resolveToolManifest } from '../src/tools/result'
import { Tool } from '../src/types'

function makeTool(name: string): Tool {
  const tool: Tool = {
    name,
    description: name,
    parameters: z.object({}),
    async execute() {
      return { success: true, message: 'ok' }
    },
  }

  return {
    ...tool,
    manifest: resolveToolManifest(tool),
  }
}

test('session blockedTools deny tool execution', () => {
  const tool = makeTool('open_app')
  const decision = assessToolRisk(tool, {}, 'terminal', { blockedTools: ['open_app'] })
  assert.equal(decision.allowed, false)
  assert.match(decision.reason, /blocked by current session policy/)
})

test('session allowedTools restrict execution to explicit tools', () => {
  const tool = makeTool('open_app')
  const decision = assessToolRisk(tool, {}, 'terminal', { allowedTools: ['get_current_time'] })
  assert.equal(decision.allowed, false)
  assert.match(decision.reason, /blocked by current session policy/)
})

test('tool manifests enforce source restrictions', () => {
  const tool = makeTool('execute_applescript')
  const decision = assessToolRisk(tool, {}, 'slack')
  assert.equal(decision.allowed, false)
  assert.match(decision.reason, /not allowed from slack/)
})

test('remote sandbox blocks non-read permissions by default', () => {
  const tool = makeTool('open_app')
  const prev = config.security.channelToolAllowlists.telegram
  config.security.channelToolAllowlists.telegram = ['open_app']
  try {
    const decision = assessToolRisk(tool, {}, 'telegram')
    assert.equal(decision.allowed, false)
    assert.match(decision.reason, /Remote sandbox blocks automation tools/)
  } finally {
    config.security.channelToolAllowlists.telegram = prev
  }
})

test('session sandbox off can disable sandbox restriction for remote sessions', () => {
  const tool = makeTool('open_app')
  const prev = config.security.channelToolAllowlists.telegram
  config.security.channelToolAllowlists.telegram = ['open_app']
  try {
    const decision = assessToolRisk(tool, {}, 'telegram', { sandboxMode: 'off' })
    assert.equal(decision.allowed, true)
    assert.equal(decision.requiresAuthorization, true)
  } finally {
    config.security.channelToolAllowlists.telegram = prev
  }
})
