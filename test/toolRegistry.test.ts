import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { ToolRegistry } from '../src/tools/registry'

test('registry infers tool metadata and normalizes success results', async () => {
  const registry = new ToolRegistry()
  registry.register({
    name: 'fs_example',
    description: 'Example filesystem tool',
    parameters: z.object({ value: z.string() }),
    execute: async ({ value }) => ({ success: true, result: `ok:${value}` }),
  })

  const tool = registry.getTool('fs_example')
  assert.ok(tool)
  assert.equal(tool?.category, 'filesystem')
  assert.equal(tool?.riskLevel, 'low')

  const result = await tool!.execute({ value: 'abc' })
  assert.equal(result.success, true)
  assert.equal(result.message, 'ok:abc')
  assert.equal(result.result, 'ok:abc')
})

test('registry preserves failures in normalized tool results', async () => {
  const registry = new ToolRegistry()
  registry.register({
    name: 'open_example',
    description: 'Example automation tool',
    parameters: z.object({}),
    execute: async () => ({ success: false, error: 'boom' }),
  })

  const tool = registry.getTool('open_example')
  assert.ok(tool)
  assert.equal(tool?.category, 'automation')
  assert.equal(tool?.riskLevel, 'medium')

  const result = await tool!.execute({})
  assert.equal(result.success, false)
  assert.equal(result.error, 'boom')
  assert.equal(result.message, 'boom')
})
