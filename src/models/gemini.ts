import type { Message } from '@apex/types'
import { config } from '@apex/core'
import { DEFAULT_GEMINI_CLOUD_MODEL_ID } from './geminiCloudModel'
import { fetchJsonWithTimeout, GEMINI_REST_HTTP_TIMEOUT_MS } from '../runtime/fetchWithTimeout'

export async function chatWithGemini(
  messages: Message[],
  model = DEFAULT_GEMINI_CLOUD_MODEL_ID,
): Promise<string> {
  const apiKey = config.apiKeys.gemini
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Add GOOGLE_GEMINI_API_KEY to .env')
  }

  const data = await fetchJsonWithTimeout<any>(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      }),
    },
    {
      timeoutMs: GEMINI_REST_HTTP_TIMEOUT_MS,
      timeoutMessage: `Gemini REST request timed out after ${GEMINI_REST_HTTP_TIMEOUT_MS}ms`,
    },
  )

  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}
