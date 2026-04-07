import fs from 'fs';
import path from 'path';
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

  async discoverSkills() {
    const skillsDir = path.join(process.cwd(), 'skills');
    if (!fs.existsSync(skillsDir)) return;

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name);
        const manifestPath = path.join(skillPath, 'skill.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            // Simplified: for now, we just log discovery. 
            // In Step 3, we'll implement the actual execution of these dynamic skills.
            logger.system(`Discovered dynamic skill: ${manifest.name}`);
          } catch (error: any) {
            logger.error(`Failed to load skill ${entry.name}: ${error.message}`);
          }
        }
      }
    }
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
