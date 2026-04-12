import { BaseProvider } from './baseProvider'
import { ApexResponse } from './apexResponse'
import type { ToolCall } from '@apex/types'
import { config } from '@apex/core'
import { normalizeToolCalls } from './toolCallParser'
import {
  fetchJsonWithTimeout,
  OLLAMA_GENERATION_TIMEOUT_MS,
  USER_FACING_LOCAL_MODEL_TIMEOUT,
} from '../runtime/fetchWithTimeout'
import { ollamaCircuitBreaker } from '../runtime/ollamaCircuitBreaker'

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? '').trim()
  if (!trimmed) return 'http://127.0.0.1:11434'
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

type OllamaChatResponse = {
  message?: {
    role?: string
    content?: string
    tool_calls?: ToolCall[]
  }
}

export class LocalProvider extends BaseProvider {
  /**
   * Calls Ollama /api/chat (OpenAI-incompatible endpoint).
   * Uses `stream: false` for now.
   */
  async generateResponse(prompt: string, context: any): Promise<ApexResponse> {
    ollamaCircuitBreaker.preflight()
    const baseUrl = normalizeBaseUrl(
      String(context?.baseUrl ?? config.ollama.host ?? 'http://127.0.0.1:11434'),
    )
    const model: string = context?.model ?? config.models.chat
    const messages = Array.isArray(context?.messages) ? context.messages : []
    const tools = context?.tools as any[] | undefined

    const combinedMessages = [...messages, ...(prompt ? [{ role: 'user', content: prompt }] : [])]

    let data: OllamaChatResponse
    try {
      data = await fetchJsonWithTimeout<OllamaChatResponse>(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: combinedMessages,
            stream: false,
            ...(tools ? { tools } : {}),
          }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS },
      )
    } catch (error: any) {
      ollamaCircuitBreaker.recordFailure()
      if (error?.message === USER_FACING_LOCAL_MODEL_TIMEOUT) {
        throw error
      }
      const msg = String(error?.message ?? error ?? '')
      throw new Error(`Local inference failed (Ollama): ${msg}`)
    }

    const text = data.message?.content ?? ''
    const toolCalls = normalizeToolCalls(data.message?.tool_calls, text)
    ollamaCircuitBreaker.recordSuccess()
    return { text, toolCalls }
  }
}
