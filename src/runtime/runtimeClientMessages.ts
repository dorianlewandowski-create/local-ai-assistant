import { config } from '@apex/core'

export function isLikelyDaemonUnreachable(errMsg: string): boolean {
  const m = errMsg.toLowerCase()
  return (
    m.includes('fetch failed') ||
    m.includes('econnrefused') ||
    m.includes('connection refused') ||
    (m.includes('network') && m.includes('127.0.0.1'))
  )
}

export function isMissingRuntimeAuthToken(errMsg: string): boolean {
  return errMsg.includes('Missing Apex runtime auth token')
}

export function isRuntimeHttpUnauthorized(errMsg: string): boolean {
  return /\bHTTP\s*401\b/i.test(errMsg)
}

/**
 * User-facing hints for runtime HTTP client failures (CLI TUI, service commands).
 */
export function formatRuntimeClientError(raw: string): string {
  const port = config.runtimeService.port
  const baseUrl = `http://127.0.0.1:${port}`
  const trust = 'docs/OPERATOR_TRUST.txt'
  if (isMissingRuntimeAuthToken(raw)) {
    return [
      `[Apex] Could not authenticate to the local runtime API (no token resolved for this process).`,
      `Detail: ${raw}`,
      '',
      'Usually the daemon has not created ~/.apex/runtime.token yet, or APEX_STATE_DIR / token env vars disagree.',
      'Try:',
      '  apex daemon',
      '  apex runtime-info',
      '  apex doctor',
      '',
      `See ${trust}`,
    ].join('\n')
  }
  if (isRuntimeHttpUnauthorized(raw)) {
    return [
      `[Apex] Could not authenticate to the local runtime API (HTTP 401).`,
      `Detail: ${raw}`,
      '',
      'This usually means the token on disk (or APEX_RUNTIME_TOKEN) no longer matches the running daemon,',
      'or you are pointing at a different install/state directory than the daemon.',
      'After git pull or moving the repo, the launchd agent may still run an older install — check "Install drift" in apex runtime-info.',
      'Try:',
      '  launchctl kickstart -k gui/$(id -u)/ai.apex.agent   # if using launchd',
      '  apex daemon',
      '  apex runtime-info',
      '',
      `See ${trust}`,
    ].join('\n')
  }
  if (isLikelyDaemonUnreachable(raw)) {
    return [
      `[Apex] Cannot reach the runtime daemon at ${baseUrl}`,
      `Detail: ${raw}`,
      '',
      'Start the daemon (separate terminal):  apex daemon',
      'Or install the background agent:       npm run launchd:install',
      '',
      'Then: apex runtime-info   apex doctor',
      '',
      `See ${trust}`,
    ].join('\n')
  }
  return [`[Apex] Runtime HTTP client error.`, `Detail: ${raw}`, '', `See ${trust}`].join('\n')
}
