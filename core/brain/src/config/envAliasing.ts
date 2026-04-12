/**
 * Apex env readers: only `APEX_*` (and non-prefixed keys like `OLLAMA_*` handled in `buildEnvConfig`).
 * Legacy `OPENMAC_*` keys are rejected — see `exitIfLegacyOpenmacEnvKeysPresent`.
 */

export type EnvSource = Record<string, string | undefined>

const TOKYO_RED = '\x1b[38;2;255;100;100m'
const RESET = '\x1b[0m'

function peekEnv(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

/** Non-empty `OPENMAC_*` keys in the environment cause immediate exit (clean break from legacy names). */
export function exitIfLegacyOpenmacEnvKeysPresent(env: EnvSource = process.env): void {
  const offenders = Object.keys(env).filter((k) => {
    if (!k.startsWith('OPENMAC_')) return false
    return String(env[k] ?? '').trim() !== ''
  })
  if (offenders.length === 0) return

  // eslint-disable-next-line no-console
  console.error(
    `${TOKYO_RED}[Apex] Legacy environment variables detected. Rename OPENMAC_* keys to the APEX_* prefix.${RESET}`,
  )
  // eslint-disable-next-line no-console
  console.error(`[Apex] Legacy keys found: ${offenders.join(', ')}`)
  // eslint-disable-next-line no-console
  console.error(`[Apex] Fix: update your .env and shell environment to use APEX_* variables only.`)
  process.exit(1)
}

export function readApexAliasedString(env: EnvSource, apexKey: string): string | undefined {
  return peekEnv(env, apexKey)
}

export function readApexAliasedBoolean(env: EnvSource, apexKey: string): boolean | undefined {
  const raw = readApexAliasedString(env, apexKey)
  if (raw === undefined) return undefined
  return raw === '1' || raw.toLowerCase() === 'true'
}

export function readApexAliasedNumber(env: EnvSource, apexKey: string): number | undefined {
  const raw = readApexAliasedString(env, apexKey)
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function readApexAliasedCsv(env: EnvSource, apexKey: string): string[] | undefined {
  const raw = readApexAliasedString(env, apexKey)
  if (!raw) return undefined
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}
