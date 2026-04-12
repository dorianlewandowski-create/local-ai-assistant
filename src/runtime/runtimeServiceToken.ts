import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOKEN_BYTES = 32

/** Default state dir (~/.apex). Override with APEX_STATE_DIR for tests. */
export function getApexStateDir(): string {
  const raw = process.env.APEX_STATE_DIR?.trim()
  if (raw) return path.resolve(raw)
  return path.join(os.homedir(), '.apex')
}

export function getDefaultRuntimeServiceTokenPath(): string {
  return path.join(getApexStateDir(), 'runtime.token')
}

function readTokenFromPath(filePath: string): string | null {
  try {
    const t = fs.readFileSync(filePath, 'utf8').trim()
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

/**
 * Explicit env wins (CI, launchd injection, manual override).
 * Next: file on disk (written by the daemon on startup).
 */
export function readRuntimeServiceToken(): string | null {
  const env = process.env.APEX_RUNTIME_TOKEN?.trim()
  if (env) return env

  const fromFile = process.env.APEX_RUNTIME_TOKEN_FILE?.trim()
  if (fromFile) {
    return readTokenFromPath(path.resolve(fromFile))
  }

  return readTokenFromPath(getDefaultRuntimeServiceTokenPath())
}

function ensureDirMode0700(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    // ignore
  }
}

export type EnsureRuntimeServiceTokenResult = {
  /** Secret the server accepts and in-process clients should use. */
  token: string
  /** True if this process created the on-disk token file (first run on this machine/state dir). */
  createdNew: boolean
}

/**
 * Create ~/.apex and a new random token if missing. Idempotent if file exists.
 * Returns the token string the server must accept.
 */
export function ensureRuntimeServiceToken(): string {
  return ensureRuntimeServiceTokenWithMeta().token
}

/**
 * Like {@link ensureRuntimeServiceToken} but reports whether the token file was
 * newly created (for one-time first-run operator messaging).
 */
export function ensureRuntimeServiceTokenWithMeta(): EnsureRuntimeServiceTokenResult {
  const dir = getApexStateDir()
  ensureDirMode0700(dir)
  const filePath = getDefaultRuntimeServiceTokenPath()
  const existing = readTokenFromPath(filePath)
  if (existing) {
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // ignore
    }
    return { token: existing, createdNew: false }
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // ignore
  }
  return { token, createdNew: true }
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}
