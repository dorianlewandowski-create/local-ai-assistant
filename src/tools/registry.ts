import { Tool } from '../types';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
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
