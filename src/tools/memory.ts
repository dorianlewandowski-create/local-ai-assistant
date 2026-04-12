import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { memoryStore } from '../db/memory'
import { getVectorStore } from '../db/vectorStore'

const SaveFactParams = z.object({
  fact: z
    .string()
    .min(1)
    .describe(
      'A durable fact about the user, their preferences, relationships, routines, or important context worth remembering long term.',
    ),
  category: z
    .string()
    .optional()
    .describe('Short category label such as pet, preference, health, project, family, schedule, or general.'),
  source: z
    .string()
    .optional()
    .describe('Where this fact came from, such as conversation, file event, calendar, or weather analysis.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence from 0 to 1 that this fact is accurate and worth keeping.'),
})

export const saveFact: Tool<typeof SaveFactParams> = {
  name: 'save_fact',
  description:
    'Save a durable fact into long-term memory for future personalization and proactive assistance.',
  parameters: SaveFactParams,
  execute: async ({ fact, category, source, confidence }) => {
    try {
      const memory = memoryStore.saveFact({ fact, category, source, confidence })
      return { success: true, memory }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const RecallFactsParams = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'What you want to remember. Use keywords about the current user request, event, project, preference, person, pet, or situation.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Maximum number of memories to return. Use a small number like 3 to 5 unless broader recall is necessary.',
    ),
})

export const recallFacts: Tool<typeof RecallFactsParams> = {
  name: 'recall_facts',
  description:
    'Recall relevant long-term memories so the assistant can personalize suggestions and decisions.',
  parameters: RecallFactsParams,
  execute: async ({ query, limit = 5 }) => {
    try {
      const memories = memoryStore.recallFacts(query, limit)
      return { success: true, memories }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

const SearchVectorMemoryParams = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'The semantic search query to run against vector memory. Use natural language describing the concept, file, event, conversation, or topic you want to retrieve.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Maximum number of vector memory matches to return. Use a small number like 3 to 5 unless broader recall is needed.',
    ),
})

export const searchVectorMemory: Tool<typeof SearchVectorMemoryParams> = {
  name: 'search_vector_memory',
  description:
    'Search LanceDB vector memory for semantically similar file contents, prior chats, and other stored knowledge chunks.',
  parameters: SearchVectorMemoryParams,
  execute: async ({ query, limit = 5 }) => {
    try {
      const matches = await getVectorStore().searchSimilar(query, limit)
      const summary =
        matches.length === 0
          ? `No vector memory matches found for: ${query}`
          : matches
              .map((match, index) => `${index + 1}. [${match.scope}] ${match.source}: ${match.content}`)
              .join('\n')

      return {
        success: true,
        matches,
        summary,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

toolRegistry.register(saveFact)
toolRegistry.register(recallFacts)
toolRegistry.register(searchVectorMemory)
