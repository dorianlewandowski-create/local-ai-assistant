import { config } from '@apex/core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getLaunchdPlistPath } from '../launchd'
import { resolveApexInstallRoot } from './installRoot'
import { DOCTOR_HTTP_TIMEOUT_MS, fetchJsonWithTimeout, fetchTextWithTimeout } from './fetchWithTimeout'
import {
  getApexStateDir,
  getDefaultRuntimeServiceTokenPath,
  readRuntimeServiceToken,
} from './runtimeServiceToken'
import {
  computeInstallDiagnostics,
  formatInstallMismatchRemediationLines,
  type InstallDiagnostics,
} from './installMismatch'

const LAUNCHD_LABEL = 'ai.apex.agent'

function guiUserId(): number {
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

function tryLaunchdJobSummary(): { state: 'loaded' | 'missing' | 'unknown'; detail?: string } {
  const plistPath = getLaunchdPlistPath()
  if (!fs.existsSync(plistPath)) {
    return { state: 'missing' }
  }
  if (process.platform !== 'darwin') {
    return { state: 'unknown', detail: 'launchd is macOS-only' }
  }
  try {
    const out = execFileSync('launchctl', ['print', `gui/${guiUserId()}/${LAUNCHD_LABEL}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
    })
    const line =
      out
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('state =') || l.startsWith('pid =')) ?? ''
    return { state: 'loaded', detail: line || 'job present (see launchctl print)' }
  } catch (e: any) {
    const stderr = e?.stderr ? String(e.stderr) : ''
    const msg = (stderr.trim() || String(e?.message ?? e)).trim()
    return { state: 'unknown', detail: msg.slice(0, 200) }
  }
}

function statTokenFile(tokenPath: string): { modeOctal: string; mtimeIso: string } | null {
  try {
    const st = fs.statSync(tokenPath)
    const modeOctal = (st.mode & 0o777).toString(8).padStart(3, '0')
    return { modeOctal, mtimeIso: st.mtime.toISOString() }
  } catch {
    return null
  }
}

export type RuntimeInfoOptions = {
  json?: boolean
}

/** JSON / human output contract for `apex runtime-info` (no secrets). */
export type RuntimeInfoPayload = {
  runtimeBaseUrl: string
  configRuntimePort: number
  apexStateDir: string
  tokenFileDefaultPath: string
  tokenResolvedFrom: 'APEX_RUNTIME_TOKEN' | 'APEX_RUNTIME_TOKEN_FILE' | 'file'
  /** Preformatted "Source:" line for human output (no secret values). */
  tokenSourceHuman: string
  tokenFileCheckedPath: string
  tokenFileExists: boolean
  tokenFileModeOctal: string | null
  tokenFileMtimeIso: string | null
  installRoot: string
  nativeBridgePath: string
  nativeBridgePresent: boolean
  healthOk: boolean
  healthDetail: string
  authenticatedApiProbe: 'skipped_no_token' | 'ok' | 'unauthorized' | 'error'
  authenticatedApiDetail: string
  launchdPlistPath: string
  launchdPlistPresent: boolean
  launchdJob: { state: 'loaded' | 'missing' | 'unknown'; detail?: string }
  operatorDocs: [string, string]
  /** Install-root drift (CLI vs daemon vs launchd plist); no secrets. */
  installDiagnostics: InstallDiagnostics
}

export type RuntimeInfoGatherDeps = {
  fetchTextWithTimeout: typeof fetchTextWithTimeout
  fetchJsonWithTimeout: typeof fetchJsonWithTimeout
  tryLaunchdJobSummary: () => { state: 'loaded' | 'missing' | 'unknown'; detail?: string }
  resolveApexInstallRoot: () => string
}

function defaultGatherDeps(): RuntimeInfoGatherDeps {
  return {
    fetchTextWithTimeout,
    fetchJsonWithTimeout,
    tryLaunchdJobSummary,
    resolveApexInstallRoot,
  }
}

/**
 * Collects operator-facing runtime facts (never includes the token value).
 * Injectable `deps` are for unit tests; production uses real HTTP / launchd / paths.
 */
export async function buildRuntimeInfoPayload(
  deps: Partial<RuntimeInfoGatherDeps> = {},
): Promise<RuntimeInfoPayload> {
  const d = { ...defaultGatherDeps(), ...deps }
  const baseUrl = `http://127.0.0.1:${config.runtimeService.port}`
  const tokenPath = getDefaultRuntimeServiceTokenPath()
  const stateDir = getApexStateDir()
  const installRoot = d.resolveApexInstallRoot()
  const bridgeRel = path.join('nodes', 'macos', 'claw-native-bridge')
  const bridgePath = path.join(installRoot, bridgeRel)
  const bridgeOk = fs.existsSync(bridgePath)

  const envToken = Boolean(process.env.APEX_RUNTIME_TOKEN?.trim())
  const envTokenFile = process.env.APEX_RUNTIME_TOKEN_FILE?.trim() ?? ''
  const tokenSourceHuman = envToken
    ? 'APEX_RUNTIME_TOKEN (value not shown)'
    : envTokenFile
      ? `APEX_RUNTIME_TOKEN_FILE=${envTokenFile}`
      : 'default file'
  const onDiskPath = envTokenFile ? path.resolve(envTokenFile) : tokenPath
  const onDiskExists = fs.existsSync(onDiskPath)
  const onDiskStat = onDiskExists ? statTokenFile(onDiskPath) : null

  let healthOk = false
  let healthDetail = ''
  try {
    const r = await d.fetchTextWithTimeout(
      `${baseUrl}/health`,
      { method: 'GET' },
      { timeoutMs: DOCTOR_HTTP_TIMEOUT_MS },
    )
    healthOk = r.ok && r.text.trim() === 'ok'
    healthDetail = `HTTP ${r.status} body=${JSON.stringify(r.text.slice(0, 40))}`
  } catch (e: any) {
    healthDetail = String(e?.message ?? e)
  }

  const resolvedToken = readRuntimeServiceToken()
  let authProbe: RuntimeInfoPayload['authenticatedApiProbe'] = 'skipped_no_token'
  let authDetail = ''
  let statusJson: unknown | null = null
  if (resolvedToken) {
    try {
      statusJson = await d.fetchJsonWithTimeout(
        `${baseUrl}/api/status`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${resolvedToken}`,
          },
        },
        {
          timeoutMs: DOCTOR_HTTP_TIMEOUT_MS,
          timeoutMessage: `GET /api/status timed out after ${DOCTOR_HTTP_TIMEOUT_MS}ms`,
        },
      )
      authProbe = 'ok'
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      authDetail = msg
      if (/\bHTTP\s*401\b/i.test(msg)) {
        authProbe = 'unauthorized'
      } else {
        authProbe = 'error'
      }
    }
  }

  const launchd = d.tryLaunchdJobSummary()
  const plistPath = getLaunchdPlistPath()
  const plistPresent = fs.existsSync(plistPath)
  const installDiagnostics = computeInstallDiagnostics({
    localInstallRoot: installRoot,
    statusJson,
    launchdPlistPath: plistPath,
    launchdPlistPresent: plistPresent,
    authenticatedStatusOk: authProbe === 'ok',
  })

  return {
    runtimeBaseUrl: baseUrl,
    configRuntimePort: config.runtimeService.port,
    apexStateDir: stateDir,
    tokenFileDefaultPath: tokenPath,
    tokenResolvedFrom: envToken ? 'APEX_RUNTIME_TOKEN' : envTokenFile ? 'APEX_RUNTIME_TOKEN_FILE' : 'file',
    tokenSourceHuman,
    tokenFileCheckedPath: onDiskPath,
    tokenFileExists: onDiskExists,
    tokenFileModeOctal: onDiskStat?.modeOctal ?? null,
    tokenFileMtimeIso: onDiskStat?.mtimeIso ?? null,
    installRoot,
    nativeBridgePath: bridgePath,
    nativeBridgePresent: bridgeOk,
    healthOk,
    healthDetail: healthOk ? 'ok' : healthDetail,
    authenticatedApiProbe: authProbe,
    authenticatedApiDetail: authDetail,
    launchdPlistPath: getLaunchdPlistPath(),
    launchdPlistPresent: fs.existsSync(getLaunchdPlistPath()),
    launchdJob: launchd,
    operatorDocs: ['docs/OPERATOR_TRUST.txt', 'docs/PAIRING_SECURITY.txt'],
    installDiagnostics,
  }
}

/** Human-readable lines (for tests and to keep output logic in one place). */
export function formatRuntimeInfoLines(payload: RuntimeInfoPayload): string[] {
  const lines: string[] = []

  lines.push('Apex runtime info')
  lines.push(`  Base URL:     ${payload.runtimeBaseUrl}`)
  lines.push(`  Install root: ${payload.installRoot}`)
  lines.push(
    `  Bridge:       ${payload.nativeBridgePresent ? 'present' : 'MISSING'} (${payload.nativeBridgePath})`,
  )
  lines.push(`  State dir:    ${payload.apexStateDir}`)
  lines.push('  Token')
  lines.push(`    Default path:   ${payload.tokenFileDefaultPath}`)
  lines.push(`    Source:         ${payload.tokenSourceHuman}`)
  lines.push(`    Resolved path:  ${payload.tokenFileCheckedPath}`)
  lines.push(`    Exists:         ${payload.tokenFileExists ? 'yes' : 'no'}`)
  if (payload.tokenFileExists && payload.tokenFileModeOctal != null && payload.tokenFileMtimeIso != null) {
    lines.push(`    Mode:           ${payload.tokenFileModeOctal}`)
    lines.push(`    Modified:       ${payload.tokenFileMtimeIso}`)
  }
  lines.push(`  GET /health:  ${payload.healthOk ? 'ok' : `not ok (${payload.healthDetail})`}`)
  if (payload.authenticatedApiProbe === 'skipped_no_token') {
    lines.push(`  GET /api/status (auth): skipped — no token resolved for this process`)
    lines.push(`    Start the daemon once or set APEX_RUNTIME_TOKEN / APEX_RUNTIME_TOKEN_FILE.`)
  } else if (payload.authenticatedApiProbe === 'ok') {
    lines.push(`  GET /api/status (auth): ok`)
  } else if (payload.authenticatedApiProbe === 'unauthorized') {
    lines.push(`  GET /api/status (auth): rejected (401)`)
    lines.push(
      `    Likely token mismatch vs running daemon, or stale file. Try: restart daemon; see docs/OPERATOR_TRUST.txt`,
    )
  } else {
    lines.push(`  GET /api/status (auth): error (${payload.authenticatedApiDetail})`)
  }

  lines.push('  launchd')
  lines.push(
    `    Plist: ${payload.launchdPlistPresent ? 'present' : 'missing'} (${payload.launchdPlistPath})`,
  )
  if (payload.launchdJob.state === 'loaded') {
    lines.push(`    Job:   ${payload.launchdJob.detail ?? 'present'}`)
  } else if (payload.launchdJob.state === 'missing') {
    lines.push(`    Job:   not loaded (install with: npm run launchd:install)`)
  } else {
    lines.push(`    Job:   unknown (${payload.launchdJob.detail ?? 'n/a'})`)
  }

  const id = payload.installDiagnostics
  lines.push('  Install drift')
  lines.push(`    This CLI install root: ${id.localInstallRoot}`)
  if (id.daemonInstallRoot) {
    lines.push(`    Daemon reports root:   ${id.daemonInstallRoot}`)
    lines.push(`    CLI vs daemon:         ${id.daemonVsLocal}`)
  } else {
    lines.push(`    Daemon reports root:   (unavailable — authenticate to /api/status)`)
    lines.push(`    CLI vs daemon:         unavailable`)
  }
  if (id.launchdWorkingDirectory) {
    lines.push(`    launchd plist WD:      ${id.launchdWorkingDirectory}`)
    lines.push(`    CLI vs launchd plist:  ${id.launchdVsLocal}`)
  } else if (payload.launchdPlistPresent) {
    lines.push(`    launchd plist WD:      (could not parse)`)
    lines.push(`    CLI vs launchd plist:  unavailable`)
  } else {
    lines.push(`    launchd plist WD:      (no plist)`)
    lines.push(`    CLI vs launchd plist:  unavailable`)
  }

  const mismatch = id.daemonVsLocal === 'mismatch' || id.launchdVsLocal === 'mismatch'
  if (mismatch) {
    lines.push('')
    lines.push('  Warning: install path mismatch (likely stale daemon or launchd plist).')
    lines.push('    Common after git pull, moving the repo, or upgrading without reinstalling launchd.')
    for (const line of formatInstallMismatchRemediationLines({ isDarwin: process.platform === 'darwin' })) {
      lines.push(line)
    }
  }

  lines.push(`  Docs: ${payload.operatorDocs.join(', ')}`)

  if (payload.healthOk && payload.authenticatedApiProbe === 'unauthorized') {
    lines.push('')
    lines.push(
      'Hint: /health is up but authenticated calls fail — align token with the running daemon (see above).',
    )
  }
  if (!payload.healthOk) {
    lines.push('')
    lines.push(
      'Hint: daemon does not appear reachable — run `apex daemon` or load launchd, then `apex doctor`.',
    )
  }
  if (!payload.nativeBridgePresent) {
    lines.push('')
    lines.push(
      'Hint: native bridge path missing under install root — set APEX_INSTALL_ROOT or run from a repo checkout.',
    )
  }

  return lines
}

/**
 * Operator-facing snapshot: localhost runtime URL, token file (never the secret),
 * install root, health + optional authenticated probe.
 */
export async function runRuntimeInfo(
  write: (line: string) => void = console.log,
  opts: RuntimeInfoOptions & { deps?: Partial<RuntimeInfoGatherDeps> } = {},
): Promise<number> {
  const payload = await buildRuntimeInfoPayload(opts.deps)

  if (opts.json) {
    write(JSON.stringify(payload, null, 2))
    return 0
  }

  for (const line of formatRuntimeInfoLines(payload)) {
    write(line)
  }

  return 0
}
