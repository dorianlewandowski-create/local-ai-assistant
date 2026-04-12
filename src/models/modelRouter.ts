import { config } from '@apex/core'
import { getModelProfiles, resolveExecutionTier as mergePromptAndAgentTier } from '../core/router'

export type ModelTier = 'fast' | 'reasoning' | 'vision' | 'coding' | 'default'

export interface ModelRoute {
  provider: 'gemini' | 'local'
  model: string
  baseUrl?: string
  apiKey?: string
}

class ModelRouter {
  resolveExecutionTier(prompt: string, agentTier: ModelTier): ModelTier {
    return mergePromptAndAgentTier(prompt, agentTier, {
      modelMode: config.modelMode,
      lockedModel: config.lockedModel,
    })
  }

  getRoute(tier: ModelTier): ModelRoute {
    if (config.modelMode === 'manual') {
      const raw = (config.lockedModel || '').trim()
      const lm = raw.toLowerCase()
      const isGemini = lm === 'gemini' || lm.includes('gemini')
      if (isGemini) {
        return {
          provider: 'gemini',
          model: getModelProfiles().ULTRA,
          apiKey: config.apiKeys.gemini,
        }
      }
      return {
        provider: 'local',
        model: raw || config.models.chat,
        baseUrl: config.ollama.host,
      }
    }

    const tiers = config.models.tiers
    let modelName: string

    switch (tier) {
      case 'fast':
        modelName = tiers.fast
        break
      case 'reasoning':
        modelName = tiers.reasoning
        break
      case 'vision':
        modelName = tiers.vision
        break
      case 'coding':
        modelName = tiers.coding
        break
      case 'default':
      default:
        modelName = config.models.chat
        break
    }

    if (tier === 'reasoning' || tier === 'coding') {
      const key = config.apiKeys.gemini?.trim()
      if (key) {
        return {
          provider: 'gemini',
          model: tiers.reasoning || getModelProfiles().ULTRA,
          apiKey: key,
        }
      }
      return {
        provider: 'local',
        // Anti-oversize guardrail: never auto-fallback to heavy local tiers when Gemini is unavailable.
        // Use the lightest safe local tier for emergency/background use.
        model: tiers.fast || config.models.chat,
        baseUrl: config.ollama.host,
      }
    }

    return {
      provider: 'local',
      model: modelName,
      baseUrl: config.ollama.host,
    }
  }
}

export const modelRouter = new ModelRouter()
