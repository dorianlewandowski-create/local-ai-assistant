import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  RELEASE_CLI_BUNDLE,
  assertReleaseLauncherUsesBundle,
  buildReleaseFlattenedDependencies,
  buildReleasePackageJson,
} from '../src/release'

test('release: canonical CLI bundle path matches bin/run.sh and build.mjs', () => {
  assert.equal(RELEASE_CLI_BUNDLE, 'dist/cli.bundle.js')
  const runSh = fs.readFileSync(path.join(__dirname, '../bin/run.sh'), 'utf8')
  assert.match(runSh, /cli\.bundle\.js/)
  const buildMjs = fs.readFileSync(path.join(__dirname, '../build.mjs'), 'utf8')
  assert.match(buildMjs, /cli\.bundle\.js/)
})

test('release: flattened manifest has no workspace: specifiers (npm tarball install)', () => {
  const root = path.join(__dirname, '..')
  const flat = buildReleaseFlattenedDependencies(root)
  for (const spec of Object.values(flat)) {
    assert.ok(!String(spec).startsWith('workspace:'), `unexpected workspace spec: ${spec}`)
  }
  const rel = buildReleasePackageJson(root) as { dependencies: Record<string, string> }
  assert.equal(rel.dependencies['@apex/macos-node'], 'file:./nodes/macos')
  for (const [name, spec] of Object.entries(rel.dependencies)) {
    assert.ok(
      !String(spec).startsWith('workspace:'),
      `${name} must not use workspace: in release manifest (${spec})`,
    )
  }
})

test('assertReleaseLauncherUsesBundle rejects unbundled cli.js drift', () => {
  assert.throws(
    () => assertReleaseLauncherUsesBundle('exec node dist/cli.js'),
    /must invoke dist\/cli\.bundle\.js.*drift/,
  )
  assert.doesNotThrow(() =>
    assertReleaseLauncherUsesBundle(`exec node "${RELEASE_CLI_BUNDLE}"`),
  )
})
