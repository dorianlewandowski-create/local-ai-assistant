import type { ToolCall } from '@apex/types'

function safeJsonParse(value: string): any | undefined {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * Best-effort tool call extraction when a model returns tool calls embedded in text.
 *
 * Supported shapes:
 * - {"tool_calls":[{...}]}
 * - [{...}]
 * - ```json ... ```
 */
export function parseToolCallsFromText(text: string): ToolCall[] {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []

  // 1) Look for a fenced JSON block first.
  const fence = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)
  const fenced = fence?.[1]?.trim()
  if (fenced) {
    const parsed = safeJsonParse(fenced)
    const calls = (parsed?.tool_calls ?? parsed) as any
    if (Array.isArray(calls)) return calls as ToolCall[]
  }

  // 2) Look for a top-level JSON object/array somewhere in the string.
  const firstBrace = trimmed.indexOf('{')
  const firstBracket = trimmed.indexOf('[')
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket)
  if (start >= 0) {
    const candidate = trimmed.slice(start)
    const parsed = safeJsonParse(candidate)
    if (parsed) {
      const calls = (parsed?.tool_calls ?? parsed) as any
      if (Array.isArray(calls)) return calls as ToolCall[]
    }
  }

  return []
}

export function normalizeToolCalls(toolCalls: unknown, fallbackText?: string): ToolCall[] {
  if (Array.isArray(toolCalls)) return toolCalls as ToolCall[]
  if (typeof fallbackText === 'string') return parseToolCallsFromText(fallbackText)
  return []
}
