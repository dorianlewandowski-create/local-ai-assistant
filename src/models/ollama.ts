import {
  AudioTranscriptionProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatModelProvider,
  EmbeddingModelProvider,
  VisionModelProvider,
} from './provider'
import { config } from '@apex/core'
import fs from 'node:fs'
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

function getOllamaBaseUrl(): string {
  return normalizeBaseUrl(config.ollama.host || 'http://127.0.0.1:11434')
}

export class OllamaChatProvider implements ChatModelProvider {
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    ollamaCircuitBreaker.preflight()
    const baseUrl = getOllamaBaseUrl()
    try {
      const data = await fetchJsonWithTimeout<any>(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: false,
            ...(request.tools ? { tools: request.tools } : {}),
          }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS },
      )
      ollamaCircuitBreaker.recordSuccess()
      return {
        message: {
          role: 'assistant',
          content: String(data?.message?.content ?? ''),
          tool_calls: (data?.message?.tool_calls as any) ?? undefined,
        },
      }
    } catch (error: any) {
      ollamaCircuitBreaker.recordFailure()
      if (error?.message === USER_FACING_LOCAL_MODEL_TIMEOUT) {
        throw error
      }
      const msg = String(error?.message ?? error ?? '')
      throw new Error(`Local inference failed (Ollama): ${msg}`)
    }
  }
}

export class OllamaEmbeddingProvider implements EmbeddingModelProvider {
  async embed(model: string, input: string): Promise<number[]> {
    ollamaCircuitBreaker.preflight()
    const baseUrl = getOllamaBaseUrl()
    try {
      const data = await fetchJsonWithTimeout<any>(
        `${baseUrl}/api/embeddings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: input }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS },
      )
      const vec = data?.embedding
      if (!Array.isArray(vec)) {
        ollamaCircuitBreaker.recordFailure()
        throw new Error('Ollama embed returned invalid embedding payload')
      }
      ollamaCircuitBreaker.recordSuccess()
      return vec.map((v: any) => Number(v)).filter((v: any) => Number.isFinite(v))
    } catch (error: any) {
      ollamaCircuitBreaker.recordFailure()
      if (error?.message === USER_FACING_LOCAL_MODEL_TIMEOUT) {
        throw error
      }
      const msg = String(error?.message ?? error ?? '')
      throw new Error(`Local embeddings failed (Ollama): ${msg}`)
    }
  }
}

export class OllamaVisionProvider implements VisionModelProvider {
  async analyzeImage(model: string, imagePath: string, prompt: string): Promise<string> {
    ollamaCircuitBreaker.preflight()
    const baseUrl = getOllamaBaseUrl()
    const image = fs.readFileSync(imagePath).toString('base64')
    try {
      const data = await fetchJsonWithTimeout<any>(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt, images: [image] }],
            stream: false,
          }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS },
      )
      ollamaCircuitBreaker.recordSuccess()
      return String(data?.message?.content ?? '').trim()
    } catch (error: any) {
      ollamaCircuitBreaker.recordFailure()
      if (error?.message === USER_FACING_LOCAL_MODEL_TIMEOUT) {
        throw error
      }
      const msg = String(error?.message ?? error ?? '')
      throw new Error(`Local vision failed (Ollama): ${msg}`)
    }
  }
}

export class OllamaAudioTranscriptionProvider implements AudioTranscriptionProvider {
  async transcribe(model: string, audioPath: string, prompt: string): Promise<string> {
    // This provider is currently implemented as "chat with file payload".
    // Keep it bounded so a stuck local model can't freeze the daemon.
    ollamaCircuitBreaker.preflight()
    const baseUrl = getOllamaBaseUrl()
    const audio = fs.readFileSync(audioPath).toString('base64')
    try {
      const data = await fetchJsonWithTimeout<any>(
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt, images: [audio] }],
            stream: false,
          }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS },
      )
      ollamaCircuitBreaker.recordSuccess()
      return String(data?.message?.content ?? '').trim()
    } catch (error: any) {
      ollamaCircuitBreaker.recordFailure()
      if (error?.message === USER_FACING_LOCAL_MODEL_TIMEOUT) {
        throw error
      }
      const msg = String(error?.message ?? error ?? '')
      throw new Error(`Local transcription failed (Ollama): ${msg}`)
    }
  }
}

export const ollamaChatProvider = new OllamaChatProvider()
export const ollamaEmbeddingProvider = new OllamaEmbeddingProvider()
export const ollamaVisionProvider = new OllamaVisionProvider()
export const ollamaAudioTranscriptionProvider = new OllamaAudioTranscriptionProvider()
