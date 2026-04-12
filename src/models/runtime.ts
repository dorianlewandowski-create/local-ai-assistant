import { logger } from '../utils/logger'
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatModelProvider,
  EmbeddingModelProvider,
} from './provider'

function uniqueModels(primary: string, fallback?: string): string[] {
  return [primary, fallback]
    .filter((value): value is string => Boolean(value && value.trim()))
    .filter((value, index, all) => all.indexOf(value) === index)
}

export async function chatWithFallback(
  provider: ChatModelProvider,
  request: ChatCompletionRequest,
  fallbackModel?: string,
): Promise<ChatCompletionResponse> {
  const models = uniqueModels(request.model, fallbackModel)
  let lastError: unknown

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]
    try {
      if (index > 0) {
        logger.warn(`Chat model failover: retrying with fallback model ${model}`)
      }

      return await provider.chat({
        ...request,
        model,
      })
    } catch (error) {
      lastError = error
      logger.warn(`Chat model ${model} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function embedWithFallback(
  provider: EmbeddingModelProvider,
  primaryModel: string,
  input: string,
  fallbackModel?: string,
): Promise<number[]> {
  const models = uniqueModels(primaryModel, fallbackModel)
  let lastError: unknown

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]
    try {
      if (index > 0) {
        logger.warn(`Embedding model failover: retrying with fallback model ${model}`)
      }

      return await provider.embed(model, input)
    } catch (error) {
      lastError = error
      logger.warn(
        `Embedding model ${model} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
