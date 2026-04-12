import type { TaskSource } from '@apex/types'
import type { RuntimePromptSubmission } from './api'

const KNOWN_SOURCES: TaskSource[] = [
  'terminal',
  'file_watcher',
  'whatsapp',
  'telegram',
  'slack',
  'discord',
  'scheduler',
]

function isTaskSource(s: unknown): s is TaskSource {
  return typeof s === 'string' && (KNOWN_SOURCES as readonly string[]).includes(s)
}

/**
 * Parse and validate `/api/prompt` JSON. Requires a known `source` enum (no arbitrary strings).
 * `terminal` defaults `sourceId` to `local-console` when omitted (matches interactive CLI).
 */
export function parseRuntimePromptBody(
  raw: unknown,
): { ok: true; value: RuntimePromptSubmission } | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' }
  }
  const body = raw as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (!prompt.trim()) {
    return { ok: false, error: 'Missing or empty prompt.' }
  }
  if (!isTaskSource(body.source)) {
    return { ok: false, error: 'Invalid or unsupported task source.' }
  }
  const source = body.source
  let sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''
  if (source === 'terminal' && !sourceId) {
    sourceId = 'local-console'
  }
  if (!sourceId) {
    return { ok: false, error: 'Missing sourceId for this source.' }
  }
  const metadata =
    body.metadata != null && typeof body.metadata === 'object'
      ? (body.metadata as Record<string, unknown>)
      : undefined

  return {
    ok: true,
    value: {
      source,
      sourceId,
      prompt,
      metadata,
    },
  }
}
