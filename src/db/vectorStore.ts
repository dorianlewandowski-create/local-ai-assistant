import path from 'path'
import { config } from '@apex/core'
import { ollamaEmbeddingProvider } from '../models/ollama'
import { embedWithFallback } from '../models/runtime'
import { VectorStore as BaseVectorStore, type VectorRecordInput } from '@apex/memory'

const DEFAULT_DB_PATH = config.storage.vectorStorePath
const FALLBACK_DB_PATH = path.join(process.cwd(), 'data', 'lancedb')
const EMBEDDING_MODEL = config.models.embedding
const FALLBACK_EMBEDDING_MODEL = config.models.embeddingFallback
const MAX_CONTENT_LENGTH = 12000

export type { VectorRecordInput } from '@apex/memory'

export class VectorStore extends BaseVectorStore {
  constructor(dbPath = DEFAULT_DB_PATH) {
    super({
      dbPath,
      fallbackDbPath: FALLBACK_DB_PATH,
      tableName: 'knowledge_chunks',
      maxContentLength: MAX_CONTENT_LENGTH,
      embed: (input) =>
        embedWithFallback(ollamaEmbeddingProvider, EMBEDDING_MODEL, input, FALLBACK_EMBEDDING_MODEL),
    })
  }
}

let singleton: VectorStore | null = null

export function getVectorStore(): VectorStore {
  if (!singleton) {
    singleton = new VectorStore()
  }
  return singleton
}
