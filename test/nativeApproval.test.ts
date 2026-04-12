import test from 'node:test'
import assert from 'node:assert/strict'
import { NativeApprovalManager } from '../src/gateways/nativeApproval'

test('native approval manager resolves approval decisions', async () => {
  const manager = new NativeApprovalManager()
  const result = manager.request(
    {
      id: 'approval-1',
      source: 'slack',
      sourceId: 'DM1',
      toolName: 'open_app',
      command: 'open_app {}',
      reason: 'Need approval',
      permissionClass: 'automation',
    },
    async () => undefined,
  )

  await Promise.resolve()
  assert.equal(manager.getPendingCount(), 1)
  assert.equal(manager.settle('approval-1', true), true)
  assert.equal(await result, true)
})

test('native approval manager returns false for unknown approvals', () => {
  const manager = new NativeApprovalManager()
  assert.equal(manager.settle('missing', true), false)
})
