export type FetchTimeoutOptions = {
  timeoutMs: number
  signal?: AbortSignal
  /**
   * When the deadline is exceeded, this message is thrown instead of
   * {@link USER_FACING_LOCAL_MODEL_TIMEOUT} (used for Ollama-specific paths).
   */
  timeoutMessage?: string
}

/**
 * Wall-clock budget for Ollama chat/generate/embed (connect through response body).
 * Default 120s — short budgets (e.g. 15s) often false-positive on cold starts / large local models.
 * Override with `APEX_OLLAMA_GENERATION_TIMEOUT_MS` (milliseconds, clamped 5s–30m).
 */
export const OLLAMA_GENERATION_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(30 * 60_000, Number(process.env.APEX_OLLAMA_GENERATION_TIMEOUT_MS || 0) || 120_000),
)

/** Shown in the CLI / orchestrator when a local Ollama call hits the deadline. */
export const USER_FACING_LOCAL_MODEL_TIMEOUT =
  '⚠️ Local model timed out (Ollama). Ensure Ollama is running (`ollama serve`) and the model is pulled; if loads are slow, set APEX_OLLAMA_GENERATION_TIMEOUT_MS higher in `.env`.'

export function isLikelyFetchTimeout(error: unknown): boolean {
  const e = error as { name?: string; message?: string }
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true
  const msg = String(e?.message ?? error ?? '')
  return msg === 'timeout' || /^timeout$/i.test(msg.trim())
}

function abortSignalTimeoutFallback(ms: number): AbortSignal {
  const c = new AbortController()
  setTimeout(() => c.abort(new Error('timeout')), ms)
  return c.signal
}

function createMergedTimeoutSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const hasTimeoutApi =
    typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function'
  const timeoutSig = hasTimeoutApi
    ? (AbortSignal as any).timeout(timeoutMs)
    : abortSignalTimeoutFallback(timeoutMs)

  if (outer && typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any([outer, timeoutSig])
  }
  return timeoutSig
}

/**
 * Node fetch can hang indefinitely if the upstream stops responding mid-stream.
 * This wrapper enforces a hard timeout and composes optional caller signals.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: FetchTimeoutOptions,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs)

  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal

  try {
    return await fetch(input, { ...init, signal })
  } catch (error) {
    if (opts.signal?.aborted) {
      throw error
    }
    if (isLikelyFetchTimeout(error)) {
      throw new Error(opts.timeoutMessage ?? 'timeout')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/** Generic outbound HTTP for tools / integrations (not Ollama-specific messaging). */
export const TOOL_HTTP_TIMEOUT_MS = Math.max(
  3000,
  Math.min(180_000, Number(process.env.APEX_TOOL_HTTP_TIMEOUT_MS || 0) || 45_000),
)

/** REST call to Gemini `generateContent` (models/gemini.ts). */
export const GEMINI_REST_HTTP_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(180_000, Number(process.env.APEX_GEMINI_REST_HTTP_TIMEOUT_MS || 0) || 120_000),
)

export const DOCTOR_HTTP_TIMEOUT_MS = Math.max(
  2000,
  Math.min(60_000, Number(process.env.APEX_DOCTOR_HTTP_TIMEOUT_MS || 0) || 8_000),
)

export const STARTUP_OLLAMA_TAGS_TIMEOUT_MS = Math.max(
  2000,
  Math.min(60_000, Number(process.env.APEX_STARTUP_OLLAMA_TAGS_TIMEOUT_MS || 0) || 8_000),
)

/**
 * Like {@link fetchWithTimeout} but keeps the same deadline for the full round trip
 * (TCP connect, headers, and JSON body). `fetchWithTimeout` alone can return as soon as
 * headers arrive while `resp.json()` still blocks forever on a stalled body.
 */
export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'signal'>,
  opts: FetchTimeoutOptions,
): Promise<T> {
  const mergedSignal = createMergedTimeoutSignal(opts.timeoutMs, opts.signal)

  try {
    const resp = await fetch(input, { ...init, signal: mergedSignal })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}${body ? ` - ${body.slice(0, 200)}` : ''}`)
    }
    return (await resp.json()) as T
  } catch (error) {
    if (opts.signal?.aborted) {
      throw error
    }
    if (isLikelyFetchTimeout(error)) {
      throw new Error(opts.timeoutMessage ?? USER_FACING_LOCAL_MODEL_TIMEOUT)
    }
    throw error
  }
}

/**
 * Full round-trip fetch for non-JSON bodies (plain text). Same deadline semantics as
 * {@link fetchJsonWithTimeout} for connect + body read.
 */
export async function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: Omit<RequestInit, 'signal'>,
  opts: FetchTimeoutOptions,
): Promise<{ ok: boolean; status: number; text: string }> {
  const mergedSignal = createMergedTimeoutSignal(opts.timeoutMs, opts.signal)
  const msg = opts.timeoutMessage ?? `HTTP request timed out after ${opts.timeoutMs}ms`

  try {
    const resp = await fetch(input, { ...init, signal: mergedSignal })
    const text = await resp.text()
    return { ok: resp.ok, status: resp.status, text }
  } catch (error) {
    if (opts.signal?.aborted) {
      throw error
    }
    if (isLikelyFetchTimeout(error)) {
      throw new Error(msg)
    }
    throw error
  }
}
