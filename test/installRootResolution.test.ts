import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveApexInstallRoot } from '@apex/macos-node'

test('resolveApexInstallRoot respects APEX_INSTALL_ROOT', () => {
  const prev = process.env.APEX_INSTALL_ROOT
  const want = path.resolve('/tmp/apex-install-root-test')
  process.env.APEX_INSTALL_ROOT = want
  try {
    assert.equal(resolveApexInstallRoot(), want)
  } finally {
    if (prev === undefined) delete process.env.APEX_INSTALL_ROOT
    else process.env.APEX_INSTALL_ROOT = prev
  }
})
