import type { TaskEnvelope } from '@apex/types'

/**
 * Stable id for log correlation: prefers `task.metadata.correlationId` (CLI/daemon),
 * falls back to `task.id`.
 */
export function resolveTraceId(task: TaskEnvelope): string {
  const raw =
    task.metadata && typeof (task.metadata as { correlationId?: unknown }).correlationId === 'string'
      ? String((task.metadata as { correlationId: string }).correlationId).trim()
      : ''
  return raw.length > 0 ? raw : task.id
}

/** When true, emit one JSON object per line on stderr (structured trace). */
export function apexTraceEnabled(): boolean {
  const v = String(process.env.APEX_TRACE ?? '')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'json' || v === 'stderr'
}

/**
 * Machine-readable trace line. Uses stderr so stdout stays clean for TUI/pipes.
 * Enable with APEX_TRACE=1 (or true/json/stderr).
 */
export function emitApexTrace(
  event: string,
  fields: Record<string, unknown> & { traceId?: string; taskId?: string },
): void {
  if (!apexTraceEnabled()) {
    return
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    v: 1,
    event,
    ...fields,
  })
  try {
    process.stderr.write(`${line}\n`)
  } catch {
    // Never let tracing crash the runtime.
  }
}
