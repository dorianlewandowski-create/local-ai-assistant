import test from 'node:test'
import assert from 'node:assert/strict'
import { filterToolsForSubAgentKind, resolvePermissionClassForPolicy } from '../src/agent/subAgentToolPolicy'

test('filterToolsForSubAgentKind leaves coder and system unchanged', () => {
  const all = ['fs_write', 'execute_applescript', 'web_search']
  assert.deepEqual(filterToolsForSubAgentKind('coder', all), all)
  assert.deepEqual(filterToolsForSubAgentKind('system', all), all)
})

test('researcher excludes automation and destructive tools; keeps read + allowlisted write', () => {
  const all = ['web_search', 'execute_applescript', 'fs_rm', 'save_fact', 'read_text_file']
  const got = filterToolsForSubAgentKind('researcher', all)
  assert.ok(got.includes('web_search'))
  assert.ok(got.includes('read_text_file'))
  assert.ok(got.includes('save_fact'))
  assert.ok(!got.includes('execute_applescript'))
  assert.ok(!got.includes('fs_rm'))
})

test('resolvePermissionClassForPolicy falls back to inference when tool is not registered', () => {
  assert.equal(resolvePermissionClassForPolicy('read_text_file'), 'read')
  assert.equal(resolvePermissionClassForPolicy('execute_applescript'), 'automation')
  assert.equal(resolvePermissionClassForPolicy('fs_rm'), 'destructive')
})
