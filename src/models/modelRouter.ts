import { config } from '../config';

export type ModelTier = 'fast' | 'reasoning' | 'vision' | 'coding' | 'default';

export interface ModelRoute {
  provider: 'ollama' | 'openai' | 'gemini' | 'anthropic';
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

class ModelRouter {
  getRoute(tier: ModelTier): ModelRoute {
    const tiers = config.models.tiers;
    
    // Logic to select model based on tier
    // In the future, this can check for API keys to switch provider
    let modelName: string;
    
    switch (tier) {
      case 'fast':
        modelName = tiers.fast;
        break;
      case 'reasoning':
        modelName = tiers.reasoning;
        break;
      case 'vision':
        modelName = tiers.vision;
        break;
      case 'coding':
        modelName = tiers.coding;
        break;
      case 'default':
      default:
        modelName = config.models.chat;
        break;
    }

    // Default to Ollama for now (Privacy First)
    return {
      provider: 'ollama',
      model: modelName,
      baseUrl: config.ollama.host,
    };
  }

  /**
   * Future-proof helper to check if a cloud API is configured
   */
  private hasCloudAccess(provider: string): boolean {
    // Placeholder for actual API key checks
    return false;
  }
}

export const modelRouter = new ModelRouter();
