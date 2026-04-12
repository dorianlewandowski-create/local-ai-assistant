import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  pathsEqualResolved,
  tryParseLaunchdPlistWorkingDirectory,
  computeInstallDiagnostics,
  formatInstallMismatchRemediationLines,
} from '../src/runtime/installMismatch'
import { buildLaunchdPlist } from '../src/launchd'

test('pathsEqualResolved: same logical path', () => {
  assert.equal(pathsEqualResolved('/a/b', '/a/b'), true)
  assert.equal(pathsEqualResolved('/a/b', path.join('/a', 'b')), true)
})

test('pathsEqualResolved: different paths', () => {
  assert.equal(pathsEqualResolved('/a/b', '/a/c'), false)
})

test('tryParseLaunchdPlistWorkingDirectory parses plist from buildLaunchdPlist', () => {
  const plist = buildLaunchdPlist('/Users/me/apex-repo')
  assert.equal(tryParseLaunchdPlistWorkingDirectory(plist), '/Users/me/apex-repo')
})

test('computeInstallDiagnostics: match when daemon and plist align with local', () => {
  const local = '/proj'
  const d = computeInstallDiagnostics({
    localInstallRoot: local,
    statusJson: { install: { apexInstallRoot: local } },
    launchdPlistPath: '/x',
    launchdPlistPresent: true,
    authenticatedStatusOk: true,
  })
  assert.equal(d.daemonVsLocal, 'match')
  assert.equal(d.daemonInstallRoot, local)
})

test('computeInstallDiagnostics: mismatch vs daemon when authenticated', () => {
  const d = computeInstallDiagnostics({
    localInstallRoot: '/a',
    statusJson: { install: { apexInstallRoot: '/b' } },
    launchdPlistPath: '/x',
    launchdPlistPresent: false,
    authenticatedStatusOk: true,
  })
  assert.equal(d.daemonVsLocal, 'mismatch')
  assert.equal(d.launchdVsLocal, 'unavailable')
})

test('computeInstallDiagnostics: unavailable daemon root without auth', () => {
  const d = computeInstallDiagnostics({
    localInstallRoot: '/a',
    statusJson: { install: { apexInstallRoot: '/b' } },
    launchdPlistPath: '/x',
    launchdPlistPresent: false,
    authenticatedStatusOk: false,
  })
  assert.equal(d.daemonVsLocal, 'unavailable')
  assert.equal(d.daemonInstallRoot, null)
})

test('computeInstallDiagnostics: launchd plist mismatch when WD differs from CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-plist-'))
  const plist = buildLaunchdPlist('/old/install/root')
  const plistPath = path.join(dir, 'test.plist')
  fs.writeFileSync(plistPath, plist, 'utf8')
  const d = computeInstallDiagnostics({
    localInstallRoot: '/new/install/root',
    statusJson: null,
    launchdPlistPath: plistPath,
    launchdPlistPresent: true,
    authenticatedStatusOk: false,
  })
  assert.equal(d.launchdWorkingDirectory, '/old/install/root')
  assert.equal(d.launchdVsLocal, 'mismatch')
})

test('formatInstallMismatchRemediationLines: darwin includes kickstart', () => {
  const lines = formatInstallMismatchRemediationLines({ isDarwin: true })
  assert.ok(lines.some((l) => l.includes('launchctl kickstart')))
  assert.ok(lines.some((l) => l.includes('launchd-install')))
})

test('formatInstallMismatchRemediationLines: non-darwin is cautious', () => {
  const lines = formatInstallMismatchRemediationLines({ isDarwin: false })
  assert.ok(lines.some((l) => l.includes('macOS')))
})
