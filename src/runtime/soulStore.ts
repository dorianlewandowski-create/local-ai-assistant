import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

const ROOT_DIR = path.join(process.cwd(), 'data', 'self-improving');
const HOT_PATH = path.join(ROOT_DIR, 'memory.md');
const CORRECTIONS_PATH = path.join(ROOT_DIR, 'corrections.md');
const REFLECTIONS_PATH = path.join(ROOT_DIR, 'reflections.md');

const DEFAULT_HOT_MEMORY = `# 🧠 OpenMac HOT Memory

## Identity
You are OpenMac, an elite autonomous macOS agent. You are precise, helpful, and sophisticated.

## Confirmed Preferences
- Preferred language: English
- Interaction style: Professional and concise
- Tool Preference: Prioritize native macOS Shortcuts.
- Safety: Always use checkpoints for complex tasks.

## Learning Rules
- Pattern used 3x in 7 days → promote to HOT.
- Pattern unused 30 days → demote to WARM.
`;

export class TieredSoulStore {
  private hotMemory: string | null = null;

  async init(): Promise<void> {
    await fs.mkdir(path.join(ROOT_DIR, 'projects'), { recursive: true });
    await fs.mkdir(path.join(ROOT_DIR, 'domains'), { recursive: true });
    await fs.mkdir(path.join(ROOT_DIR, 'archive'), { recursive: true });

    if (!(await this.exists(HOT_PATH))) {
      await fs.writeFile(HOT_PATH, DEFAULT_HOT_MEMORY);
    }
    if (!(await this.exists(CORRECTIONS_PATH))) {
      await fs.writeFile(CORRECTIONS_PATH, '# 🛠️ Corrections Log\n');
    }
    if (!(await this.exists(REFLECTIONS_PATH))) {
      await fs.writeFile(REFLECTIONS_PATH, '# 🧘 Self-Reflections\n');
    }
  }

  async loadContextualMemory(context?: string): Promise<string> {
    if (!this.hotMemory) {
      this.hotMemory = await fs.readFile(HOT_PATH, 'utf-8');
    }

    let warmMemory = '';
    if (context) {
      warmMemory = await this.findWarmMemory(context);
    }

    return `--- HOT MEMORY ---\n${this.hotMemory}\n\n--- WARM CONTEXTUAL MEMORY ---\n${warmMemory || 'No specific contextual patterns found.'}`;
  }

  async logCorrection(context: string, correction: string): Promise<void> {
    const entry = `\n### [${new Date().toISOString()}] ${context}\n- ERROR: ${correction}\n`;
    await fs.appendFile(CORRECTIONS_PATH, entry);
    logger.system('Correction logged to memory.');
  }

  async logReflection(context: string, reflection: string, lesson: string): Promise<void> {
    const entry = `\n### [${new Date().toISOString()}] ${context}\n- REFLECTION: ${reflection}\n- LESSON: ${lesson}\n`;
    await fs.appendFile(REFLECTIONS_PATH, entry);
    logger.system('Self-reflection logged.');
  }

  async updateHotMemory(content: string): Promise<void> {
    this.hotMemory = content;
    await fs.writeFile(HOT_PATH, content);
    logger.system('HOT memory updated.');
  }

  // Legacy support for old SoulStore interface
  async load(): Promise<string> {
    return this.loadContextualMemory();
  }

  async save(content: string): Promise<void> {
    await this.updateHotMemory(content);
  }

  private async findWarmMemory(context: string): Promise<string> {
    // Simple heuristic: check if context matches any file names in projects or domains
    const dirs = ['projects', 'domains'];
    let combined = '';

    for (const dir of dirs) {
      try {
        const files = await fs.readdir(path.join(ROOT_DIR, dir));
        for (const file of files) {
          if (file.endsWith('.md') && context.toLowerCase().includes(file.replace('.md', '').toLowerCase())) {
            const content = await fs.readFile(path.join(ROOT_DIR, dir, file), 'utf-8');
            combined += `\n[From ${dir}/${file}]:\n${content}\n`;
          }
        }
      } catch {
        // Ignore missing dirs
      }
    }
    return combined;
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}

export const soulStore = new TieredSoulStore();
// Initialize immediately
void soulStore.init();
