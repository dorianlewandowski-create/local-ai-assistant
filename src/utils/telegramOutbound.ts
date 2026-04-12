import { config } from '@apex/core'

const MAX_MESSAGE_CHARS = 4000

function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.trim()
  if (!normalized) {
    return []
  }

  if (normalized.length <= maxChars) {
    return [normalized]
  }

  const chunks: string[] = []
  for (let i = 0; i < normalized.length; i += maxChars) {
    chunks.push(normalized.slice(i, i + maxChars))
  }

  return chunks
}

/**
 * Send plain text to the configured Telegram chat using the Bot HTTP API.
 * Does not depend on the Telegraf gateway (safe for scheduler / daemon code paths).
 */
export async function sendTelegramPlainMessage(text: string, titlePrefix = '📋 Daily digest'): Promise<void> {
  const token = config.gateways.telegram.botToken?.trim()
  const chatId = config.gateways.telegram.chatId?.trim()
  if (!token || !chatId) {
    throw new Error('Telegram bot token or chat id missing (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).')
  }

  const bodyBase = `${titlePrefix}\n\n${text.trim()}`.trim()
  const chunks = chunkText(bodyBase, MAX_MESSAGE_CHARS)
  if (chunks.length === 0) {
    return
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`

  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Telegram sendMessage failed (${res.status}): ${errText || res.statusText}`)
    }
  }
}
