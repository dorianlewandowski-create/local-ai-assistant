import fs from 'node:fs'
import path from 'node:path'

/** Normalize for comparison (mac-first; avoids trivial relative vs absolute drift). */
export function pathsEqualResolved(a: string, b: string): boolean {
  return path.resolve(a.trim()) === path.resolve(b.trim())
}

/**
 * Best-effort parse of ~/Library/LaunchAgents/…plist written by `buildLaunchdPlist`.
 * Returns WorkingDirectory (same as APEX_INSTALL_ROOT in our template).
 */
export function tryParseLaunchdPlistWorkingDirectory(plistXml: string): string | null {
  const wd = plistXml.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/)
  if (wd?.[1]) {
    const s = wd[1].trim()
    return s.length > 0 ? s : null
  }
  const env = plistXml.match(/<key>APEX_INSTALL_ROOT<\/key>\s*<string>([^<]*)<\/string>/)
  if (env?.[1]) {
    const s = env[1].trim()
    return s.length > 0 ? s : null
  }
  return null
}

export function tryReadLaunchdPlistWorkingDirectory(plistPath: string): string | null {
  try {
    const raw = fs.readFileSync(plistPath, 'utf8')
    return tryParseLaunchdPlistWorkingDirectory(raw)
  } catch {
    return null
  }
}

export type InstallDiagnostics = {
  localInstallRoot: string
  /** From GET /api/status when authenticated; null if unknown. */
  daemonInstallRoot: string | null
  /** Compares daemon-reported root to this CLI process (high confidence when auth ok). */
  daemonVsLocal: 'match' | 'mismatch' | 'unavailable'
  /** From launchd plist WorkingDirectory / APEX_INSTALL_ROOT when parse succeeds. */
  launchdWorkingDirectory: string | null
  /** Compares plist working directory to this CLI process. */
  launchdVsLocal: 'match' | 'mismatch' | 'unavailable'
}

export function computeInstallDiagnostics(input: {
  localInstallRoot: string
  statusJson: unknown | null
  launchdPlistPath: string
  launchdPlistPresent: boolean
  authenticatedStatusOk: boolean
}): InstallDiagnostics {
  const { localInstallRoot, statusJson, launchdPlistPath, launchdPlistPresent, authenticatedStatusOk } = input

  let daemonInstallRoot: string | null = null
  if (authenticatedStatusOk && statusJson && typeof statusJson === 'object') {
    const inst = (statusJson as { install?: { apexInstallRoot?: unknown } }).install
    const raw = inst?.apexInstallRoot
    if (typeof raw === 'string' && raw.trim().length > 0) {
      daemonInstallRoot = raw.trim()
    }
  }

  let daemonVsLocal: InstallDiagnostics['daemonVsLocal'] = 'unavailable'
  if (daemonInstallRoot) {
    daemonVsLocal = pathsEqualResolved(localInstallRoot, daemonInstallRoot) ? 'match' : 'mismatch'
  }

  let launchdWorkingDirectory: string | null = null
  if (launchdPlistPresent) {
    launchdWorkingDirectory = tryReadLaunchdPlistWorkingDirectory(launchdPlistPath)
  }

  let launchdVsLocal: InstallDiagnostics['launchdVsLocal'] = 'unavailable'
  if (launchdWorkingDirectory) {
    launchdVsLocal = pathsEqualResolved(localInstallRoot, launchdWorkingDirectory) ? 'match' : 'mismatch'
  }

  return {
    localInstallRoot,
    daemonInstallRoot,
    daemonVsLocal,
    launchdWorkingDirectory,
    launchdVsLocal,
  }
}

const LAUNCHD_LABEL = 'ai.apex.agent'

/** Concise remediation; commands are meant to be pasted into a macOS shell. */
export function formatInstallMismatchRemediationLines(opts: { isDarwin: boolean }): string[] {
  const kick = '    launchctl kickstart -k gui/$(id -u)/' + LAUNCHD_LABEL
  const out: string[] = ['  Try:', '    npm run launchd-install', kick, '    apex runtime-info']
  if (!opts.isDarwin) {
    return [
      '  (launchd is macOS-only) After moving the repo or upgrading, reinstall the agent from the repo root,',
      '  then compare install roots with apex runtime-info on a Mac.',
    ]
  }
  return out
}
