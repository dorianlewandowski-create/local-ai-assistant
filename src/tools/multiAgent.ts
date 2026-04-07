import { z } from 'zod';
import { Tool, TaskEnvelope } from '../types';
import { toolRegistry } from './registry';
import { createRuntimeCore } from '../runtime/runtimeCore';
import { logger } from '../utils/logger';

const SpawnHelperAgentParams = z.object({
  purpose: z.string().min(1).describe('The specific sub-task for the helper agent (e.g., "Researching AppleScript for Spotify").'),
  prompt: z.string().min(1).describe('The full instructions/prompt for the helper agent.'),
});

export const spawnHelperAgent: Tool<typeof SpawnHelperAgentParams> = {
  name: 'spawn_helper_agent',
  description: 'Spawn a specialized sub-agent to handle a specific part of a complex task. Use this for parallel processing or to isolate risky operations.',
  parameters: SpawnHelperAgentParams,
  execute: async ({ purpose, prompt }) => {
    try {
      logger.system(`Spawning helper agent for: ${purpose}`);
      
      const { orchestrator } = createRuntimeCore();
      
      const helperTask: TaskEnvelope = {
        id: `helper-${Date.now()}`,
        source: 'terminal', // Or a new source type 'helper'
        sourceId: 'primary-orchestrator',
        prompt: prompt,
        timeoutMs: 120_000,
      };

      const result = await orchestrator.processTask(helperTask);
      
      return {
        success: true,
        result: `Helper agent finished "${purpose}". Result: ${result.response}`,
        metadata: { helperTaskId: helperTask.id }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(spawnHelperAgent);
