import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildRuntimeInfoPayload,
  formatRuntimeInfoLines,
  runRuntimeInfo,
  type RuntimeInfoGatherDeps,
} from '../src/runtime/runtimeInfo'

function withEnv(updates: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(updates)) {
    prev[k] = process.env[k]
    const v = updates[k]
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(updates)) {
        const p = prev[k]
        if (p === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = p
        }
      }
    })
}

function baseDeps(overrides: Partial<RuntimeInfoGatherDeps> = {}): Partial<RuntimeInfoGatherDeps> {
  return {
    fetchTextWithTimeout: (async () =>
      ({
        ok: true,
        status: 200,
        text: 'ok',
      }) as Awaited<ReturnType<RuntimeInfoGatherDeps['fetchTextWithTimeout']>>) as any,
    fetchJsonWithTimeout: (async () => ({})) as any,
    tryLaunchdJobSummary: () => ({ state: 'missing' as const }),
    resolveApexInstallRoot: () => path.join(os.tmpdir(), 'apex-nonexistent-root'),
    ...overrides,
  }
}

test('buildRuntimeInfoPayload: missing token file, unreachable health, auth skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  await withEnv({ APEX_STATE_DIR: dir, APEX_RUNTIME_TOKEN: undefined, APEX_RUNTIME_TOKEN_FILE: undefined }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps({
        fetchTextWithTimeout: (async () => {
          throw new Error('ECONNREFUSED')
        }) as any,
      }),
    })
    assert.equal(payload.tokenFileExists, false)
    assert.equal(payload.healthOk, false)
    assert.match(payload.healthDetail, /ECONNREFUSED/)
    assert.equal(payload.authenticatedApiProbe, 'skipped_no_token')
    assert.equal(payload.launchdJob.state, 'missing')
  })
})

test('buildRuntimeInfoPayload: health ok, auth ok, token from file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  const secret = 'SECRET_RUNTIME_TOKEN_VALUE_XYZ_99'
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'runtime.token'), `${secret}\n`, { encoding: 'utf8', mode: 0o600 })

  await withEnv({ APEX_STATE_DIR: dir, APEX_RUNTIME_TOKEN: undefined, APEX_RUNTIME_TOKEN_FILE: undefined }, async () => {
    const payload = await buildRuntimeInfoPayload(baseDeps())
    assert.equal(payload.healthOk, true)
    assert.equal(payload.authenticatedApiProbe, 'ok')
    assert.equal(payload.tokenFileExists, true)
    assert.equal(payload.tokenResolvedFrom, 'file')
    assert.equal(payload.tokenSourceHuman, 'default file')

    const json = JSON.stringify(payload)
    assert.equal(json.includes(secret), false, 'JSON must not contain token value')
  })
})

test('buildRuntimeInfoPayload: health ok, auth 401', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  const secret = 'OTHER_SECRET_401'
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'runtime.token'), `${secret}\n`, { encoding: 'utf8', mode: 0o600 })

  await withEnv({ APEX_STATE_DIR: dir }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps({
        fetchJsonWithTimeout: (async () => {
          throw new Error('HTTP 401 - {"ok":false}')
        }) as any,
      }),
    })
    assert.equal(payload.healthOk, true)
    assert.equal(payload.authenticatedApiProbe, 'unauthorized')
    assert.equal(JSON.stringify(payload).includes(secret), false)

    const text = formatRuntimeInfoLines(payload).join('\n')
    assert.match(text, /401/)
    assert.match(text, /Hint: \/health is up/)
    assert.equal(text.includes(secret), false)
  })
})

test('buildRuntimeInfoPayload: token from APEX_RUNTIME_TOKEN env (value never in payload)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  const secret = 'ENV_INLINE_SECRET_ABC'
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  await withEnv(
    {
      APEX_STATE_DIR: dir,
      APEX_RUNTIME_TOKEN: secret,
      APEX_RUNTIME_TOKEN_FILE: undefined,
    },
    async () => {
      const payload = await buildRuntimeInfoPayload(baseDeps())
      assert.equal(payload.tokenResolvedFrom, 'APEX_RUNTIME_TOKEN')
      assert.equal(payload.tokenSourceHuman, 'APEX_RUNTIME_TOKEN (value not shown)')
      const json = JSON.stringify(payload)
      assert.equal(json.includes(secret), false)
      const text = formatRuntimeInfoLines(payload).join('\n')
      assert.equal(text.includes(secret), false)
    },
  )
})

test('buildRuntimeInfoPayload: APEX_RUNTIME_TOKEN_FILE points to file with secret', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  const tokPath = path.join(dir, 'custom.token')
  const secret = 'FILE_BASED_SECRET_QWERTY'
  fs.writeFileSync(tokPath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })

  await withEnv(
    {
      APEX_STATE_DIR: dir,
      APEX_RUNTIME_TOKEN: undefined,
      APEX_RUNTIME_TOKEN_FILE: tokPath,
    },
    async () => {
      const payload = await buildRuntimeInfoPayload(baseDeps())
      assert.equal(payload.tokenResolvedFrom, 'APEX_RUNTIME_TOKEN_FILE')
      assert.equal(payload.tokenFileCheckedPath, path.resolve(tokPath))
      assert.equal(JSON.stringify(payload).includes(secret), false)
    },
  )
})

test('buildRuntimeInfoPayload: native bridge present when layout exists under install root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-root-'))
  const bridgeRel = path.join('nodes', 'macos', 'claw-native-bridge')
  fs.mkdirSync(path.join(root, bridgeRel), { recursive: true })

  await withEnv({ APEX_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'apex-st-')) }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps({
        resolveApexInstallRoot: () => root,
      }),
    })
    assert.equal(payload.nativeBridgePresent, true)
    assert.equal(payload.installRoot, root)
  })
})

test('JSON contract: stable high-value keys for apex runtime-info --json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  await withEnv({ APEX_STATE_DIR: dir }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps(),
    })
    const keys = [
      'runtimeBaseUrl',
      'configRuntimePort',
      'apexStateDir',
      'tokenFileDefaultPath',
      'tokenResolvedFrom',
      'tokenSourceHuman',
      'tokenFileCheckedPath',
      'tokenFileExists',
      'installRoot',
      'nativeBridgePath',
      'nativeBridgePresent',
      'healthOk',
      'healthDetail',
      'authenticatedApiProbe',
      'authenticatedApiDetail',
      'launchdPlistPath',
      'launchdPlistPresent',
      'launchdJob',
      'operatorDocs',
      'installDiagnostics',
    ] as const
    for (const k of keys) {
      assert.ok(k in payload, `missing ${k}`)
    }
    assert.ok(Array.isArray(payload.operatorDocs))
    assert.equal(payload.operatorDocs.length, 2)
  })
})

test('buildRuntimeInfoPayload: auth probe error (non-401)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'runtime.token'), 'tok\n', { encoding: 'utf8', mode: 0o600 })

  await withEnv({ APEX_STATE_DIR: dir }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps({
        fetchJsonWithTimeout: (async () => {
          throw new Error('HTTP 503 - overloaded')
        }) as any,
      }),
    })
    assert.equal(payload.healthOk, true)
    assert.equal(payload.authenticatedApiProbe, 'error')
    assert.match(payload.authenticatedApiDetail, /503/)
  })
})

test('formatRuntimeInfoLines: install mismatch shows remediation (daemon vs CLI)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const secret = 'ZZ_INSTALL_MISMATCH_TEST_SECRET_99'
  fs.writeFileSync(path.join(dir, 'runtime.token'), `${secret}\n`, { encoding: 'utf8', mode: 0o600 })

  await withEnv({ APEX_STATE_DIR: dir }, async () => {
    const payload = await buildRuntimeInfoPayload({
      ...baseDeps({
        fetchJsonWithTimeout: (async () =>
          ({
            install: {
              apexInstallRoot: '/daemon/other/path',
              apexInstallRootEnv: null,
            },
          })) as any,
        resolveApexInstallRoot: () => '/cli/local/path',
      }),
    })
    assert.equal(payload.installDiagnostics.daemonVsLocal, 'mismatch')
    const text = formatRuntimeInfoLines(payload).join('\n')
    assert.match(text, /install path mismatch/i)
    assert.match(text, /launchd-install/)
    assert.equal(text.includes(secret), false, 'human output must not echo token value')
  })
})

test('runRuntimeInfo: json mode prints parseable payload only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-ri-'))
  const lines: string[] = []
  await withEnv({ APEX_STATE_DIR: dir }, async () => {
    const code = await runRuntimeInfo((l) => lines.push(l), {
      json: true,
      deps: baseDeps(),
    })
    assert.equal(code, 0)
    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0]!) as { authenticatedApiProbe: string }
    assert.equal(parsed.authenticatedApiProbe, 'skipped_no_token')
  })
})
