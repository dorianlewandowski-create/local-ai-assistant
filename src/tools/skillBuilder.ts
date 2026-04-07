import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CreateNewSkillParams = z.object({
  name: z.string().min(1).describe('The unique name of the skill (e.g., "control_notion").'),
  description: z.string().min(1).describe('What this skill does.'),
  parameters: z.any().describe('JSON Schema for the parameters.'),
  implementation: z.string().min(1).describe('The AppleScript or Shell script code.'),
  type: z.enum(['applescript', 'shell']).describe('The execution engine.'),
});

export const createNewSkill: Tool<typeof CreateNewSkillParams> = {
  name: 'create_new_skill',
  description: 'Create a new autonomous skill for OpenMac. Use this when you need to control an application or system feature that you do not yet have a tool for.',
  parameters: CreateNewSkillParams,
  execute: async ({ name, description, parameters, implementation, type }) => {
    try {
      const skillDir = path.join(process.cwd(), 'skills', name);
      await fs.mkdir(skillDir, { recursive: true });

      const manifest = {
        name,
        description,
        parameters,
        type,
        createdAt: new Date().toISOString(),
      };

      await fs.writeFile(path.join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2));
      const scriptFile = type === 'applescript' ? 'script.applescript' : 'run.sh';
      await fs.writeFile(path.join(skillDir, scriptFile), implementation);

      if (type === 'shell') {
        await fs.chmod(path.join(skillDir, scriptFile), 0o755);
      }

      // Hot-register the tool in the current session
      toolRegistry.register({
        name,
        description,
        parameters: z.any(), // Dynamic Zod is hard, we use any for runtime
        execute: async (args: any) => {
          const scriptPath = path.join(skillDir, scriptFile);
          if (type === 'applescript') {
            // Simple argument injection for AppleScript
            // In a mature system, we'd use a more robust template engine
            const result = await execAsync(`osascript "${scriptPath}"`);
            return { success: true, result: result.stdout };
          } else {
            const result = await execAsync(`"${scriptPath}" "${JSON.stringify(args)}"`);
            return { success: true, result: result.stdout };
          }
        }
      });

      return { success: true, result: `Skill '${name}' created and registered.` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(createNewSkill);
