import { sendNotification } from '../utils/notifier'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

/**
 * Flags tools that look like they perform destructive or state-mutating operations.
 *
 * This is intentionally conservative: it runs after the LLM has chosen a tool but
 * before the MCP request hits the server.
 */
export function isSensitiveTool(serverId: string, toolName: string): boolean {
  const haystack = `${serverId}:${toolName}`.toLowerCase()
  const patterns: RegExp[] = [
    /(^|[^a-z])delete([^a-z]|$)/i,
    /(^|[^a-z])write([^a-z]|$)/i,
    /(^|[^a-z])update([^a-z]|$)/i,
    /(^|[^a-z])drop([^a-z]|$)/i,
    /(^|[^a-z])create([^a-z]|$)/i,
    /(^|[^a-z])remove([^a-z]|$)/i,
    /(^|[^a-z])truncate([^a-z]|$)/i,
    /(^|[^a-z])insert([^a-z]|$)/i,
    /(^|[^a-z])alter([^a-z]|$)/i,
  ]

  return patterns.some((re) => re.test(haystack))
}

export async function confirmSensitiveToolExecution(options: {
  serverId: string
  toolName: string
  promptTimeoutMs?: number
}): Promise<boolean> {
  const toolLabel = `${options.serverId}:${options.toolName}`
  const promptTimeoutMs = Math.max(1_000, options.promptTimeoutMs ?? 60_000)

  // Visibility even when no TTY prompt is possible.
  await sendNotification({
    title: 'Apex',
    subtitle: 'MCP tool authorization',
    message: `Apex is requesting to run ${toolLabel}. Allow? (y/n)`,
  }).catch(() => undefined)

  // If we can't interact (daemon/no TTY), fail closed.
  if (!input.isTTY) {
    return false
  }

  const rl = readline.createInterface({ input, output })
  try {
    const question = `Apex is requesting to run ${toolLabel}. Allow? (y/n): `
    const answerPromise = rl.question(question)

    const timer = setTimeout(() => {
      // readline/promises question has no abort; we just stop waiting.
      rl.close()
    }, promptTimeoutMs)
    ;(timer as any).unref?.()

    const answer = await answerPromise.catch(() => '')
    clearTimeout(timer)

    const normalized = String(answer).trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes'
  } finally {
    rl.close()
  }
}
