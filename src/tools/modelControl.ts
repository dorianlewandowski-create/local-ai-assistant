import { z } from 'zod'
import type { Tool, TaskEnvelope } from '@apex/types'
import { toolRegistry } from './registry'
import { sessionStore } from '../runtime/sessionStore'
import { logger } from '../utils/logger'

const SetModelParams = z.object({
  model: z
    .string()
    .min(1)
    .describe('The name of the model to switch to (e.g., "gemma4:e4b", "gemini-3.1-pro-preview").'),
})

export const setModel: Tool<typeof SetModelParams> = {
  name: 'set_active_model',
  description: 'Manually switch the active AI model for the current session.',
  parameters: SetModelParams,
  execute: async ({ model }: { model: string }, context?: { task: TaskEnvelope }) => {
    try {
      if (!context?.task) {
        throw new Error('Task context missing from tool execution.')
      }
      await sessionStore.updateSessionSettings(context.task, { model })
      logger.system(`Model switched to: ${model} for session ${context.task.sourceId}`)
      return { success: true, result: `Successfully switched active model to ${model}.` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

toolRegistry.register(setModel)
