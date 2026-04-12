import test from 'node:test'
import assert from 'node:assert/strict'
import { getTranscriptionSetupHint } from '@apex/core'
import {
  ollamaAudioTranscriptionProvider,
  ollamaChatProvider,
  ollamaEmbeddingProvider,
  ollamaVisionProvider,
} from '../src/models/ollama'
import { chatWithFallback, embedWithFallback } from '../src/models/runtime'

test('ollama provider modules expose expected methods', () => {
  assert.equal(typeof ollamaChatProvider.chat, 'function')
  assert.equal(typeof ollamaEmbeddingProvider.embed, 'function')
  assert.equal(typeof ollamaVisionProvider.analyzeImage, 'function')
  assert.equal(typeof ollamaAudioTranscriptionProvider.transcribe, 'function')
})

test('chat fallback uses secondary model when primary fails', async () => {
  const provider = {
    async chat(request: { model: string }) {
      if (request.model === 'primary') {
        throw new Error('primary failed')
      }

      return {
        message: {
          role: 'assistant' as const,
          content: `used:${request.model}`,
        },
      }
    },
  }

  const result = await chatWithFallback(
    provider,
    {
      model: 'primary',
      messages: [{ role: 'user', content: 'hi' }],
    },
    'fallback',
  )

  assert.equal(result.message.content, 'used:fallback')
})

test('embedding fallback uses secondary model when primary fails', async () => {
  const provider = {
    async embed(model: string) {
      if (model === 'primary-embed') {
        throw new Error('embed failed')
      }

      return [1, 2, 3]
    },
  }

  const result = await embedWithFallback(provider, 'primary-embed', 'hello', 'fallback-embed')
  assert.deepEqual(result, [1, 2, 3])
})

test('transcription setup hint explains configuration path', () => {
  assert.match(getTranscriptionSetupHint(), /OLLAMA_TRANSCRIPTION_MODEL/)
  assert.match(getTranscriptionSetupHint(), /models\.transcription/)
})
