import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeApi } from '../src/runtime/api'
import { TaskQueue } from '../src/runtime/taskQueue'
import { runtimeServices } from '../src/runtime/services'

test('runtime api submitPrompt enqueues and returns response', async () => {
  const taskQueue = new TaskQueue(async (task) => ({
    taskId: task.id,
    source: task.source,
    agent: 'test',
    response: `handled:${task.prompt}`,
  }))

  const api = createRuntimeApi(taskQueue, { getPendingApprovalCount: () => 0 }, runtimeServices)
  const response = await api.submitPrompt({
    source: 'terminal',
    sourceId: 'local-console',
    prompt: 'ping',
  })

  assert.equal(response, 'handled:ping')
})

test('runtime api getStatusSnapshot includes install metadata', async () => {
  const taskQueue = new TaskQueue(async (task) => ({
    taskId: task.id,
    source: task.source,
    agent: 'test',
    response: 'ok',
  }))

  const api = createRuntimeApi(taskQueue, { getPendingApprovalCount: () => 0 }, runtimeServices)
  const snap = await api.getStatusSnapshot()
  assert.equal(typeof snap.install.apexInstallRoot, 'string')
  assert.ok(snap.install.apexInstallRoot.length > 0)
  assert.ok(
    snap.install.apexInstallRootEnv === null || typeof snap.install.apexInstallRootEnv === 'string',
  )
})

test('runtime api get/set session sub-agent by key round-trips', () => {
  const taskQueue = new TaskQueue(async (task) => ({
    taskId: task.id,
    source: task.source,
    agent: 'test',
    response: 'ok',
  }))

  const api = createRuntimeApi(taskQueue, { getPendingApprovalCount: () => 0 }, runtimeServices)
  api.setSessionSubAgentKindByKey('terminal', 'test-by-key-session', 'system')
  assert.equal(api.getSessionSubAgentKindByKey('terminal', 'test-by-key-session'), 'system')
  api.setSessionSubAgentKindByKey('terminal', 'test-by-key-session', undefined)
  assert.equal(api.getSessionSubAgentKindByKey('terminal', 'test-by-key-session'), undefined)
})
