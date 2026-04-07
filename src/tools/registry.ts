import { Tool } from '../types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger } from '../utils/logger';
import { inferToolCategory, inferToolRiskLevel, normalizeToolResult, resolveToolManifest } from './result';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    const normalizedTool: Tool = {
      ...tool,
      category: tool.category ?? inferToolCategory(tool.name),
      riskLevel: tool.riskLevel ?? inferToolRiskLevel(tool.name),
      manifest: resolveToolManifest(tool),
      execute: async (args: any) => {
        logger.debug(`[TOOL] ${tool.name} (${tool.category ?? inferToolCategory(tool.name)}) start`);
        const startedAt = Date.now();
        const result = await tool.execute(args);
        const normalized = normalizeToolResult({ ...tool, category: tool.category ?? inferToolCategory(tool.name), riskLevel: tool.riskLevel ?? inferToolRiskLevel(tool.name), manifest: resolveToolManifest(tool) }, result);
        logger.debug(`[TOOL] ${tool.name} end ${normalized.success ? 'ok' : 'error'} ${Date.now() - startedAt}ms`);
        return normalized;
      },
    };

    this.tools.set(tool.name, normalizedTool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Converts the registry tools into the format expected by the Ollama/OpenAI API.
   */
  getOllamaToolsDefinition(toolNames?: string[]) {
    const selectedTools = toolNames 
      ? Array.from(this.tools.values()).filter(t => toolNames.includes(t.name))
      : Array.from(this.tools.values());

    return selectedTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters)
      }
    }));
  }
}

export const toolRegistry = new ToolRegistry();
