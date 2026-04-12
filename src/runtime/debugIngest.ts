import fs from 'node:fs'
import path from 'node:path'
import { fetchWithTimeout } from './fetchWithTimeout'

const DEFAULT_INGEST_URL =
  process.env.APEX_DEBUG_INGEST_URL || 'http://127.0.0.1:7399/ingest/8d7ccfff-18a1-448b-bf40-c7c89e013f09'

const INGEST_TIMEOUT_MS = Math.min(
  5000,
  Math.max(150, Number(process.env.APEX_DEBUG_INGEST_TIMEOUT_MS || 0) || 450),
)

/**
 * JSONL trace file (correlation IDs, router decisions). Used when
 * {@link isApexDebugEmitEnabled} is true. Override path with `APEX_DEBUG_LOG_FILE`.
 */
export function getApexDebugLogFilePath(): string {
  return process.env.APEX_DEBUG_LOG_FILE ?? path.join(process.cwd(), '.cursor', 'apex-debug.log')
}

/** @deprecated Use {@link getApexDebugLogFilePath} */
export const APEX_DEBUG_LOG_FILE = getApexDebugLogFilePath()

/**
 * Enables JSONL file append + optional HTTP ingest for {@link emitDebugLog} (CLI/daemon hot paths).
 * Off by default so normal runs do not write under cwd or call localhost ingest.
 */
export function isApexDebugEmitEnabled(): boolean {
  const v = String(process.env.APEX_DEBUG ?? '')
    .trim()
    .toLowerCase()
  if (v === '1' || v === 'true' || v === 'json') return true
  if (process.env.APEX_DEBUG_LOG_FILE) return true
  return false
}

/** Best-effort remote debug ingest; never blocks the caller (fire-and-forget). */
export function postDebugIngest(payload: Record<string, unknown>): void {
  void fetchWithTimeout(
    DEFAULT_INGEST_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': String((payload as { sessionId?: string }).sessionId ?? ''),
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: INGEST_TIMEOUT_MS },
  ).catch(() => {})
}

export function appendDebugLogFile(payload: Record<string, unknown>): void {
  try {
    const file = getApexDebugLogFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch {
    // ignore
  }
}

/** Local JSONL + optional ingest (used by CLI and daemon hot paths). Opt-in via `APEX_DEBUG` or `APEX_DEBUG_LOG_FILE`. */
export function emitDebugLog(payload: Record<string, unknown>): void {
  if (!isApexDebugEmitEnabled()) return
  appendDebugLogFile(payload)
  postDebugIngest(payload)
}
