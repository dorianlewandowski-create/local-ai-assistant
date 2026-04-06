const fs = require('fs');
const path = require('path');

const srcDir = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools';
const outPath = '/Users/dorianlewandowski/mac-ai-assistant/src/tools/systemMisc.ts';

const scripts = [
  'auto_document.sh', 'autonomous_fix.sh', 'blackboard_clear.sh', 'blackboard_post.sh',
  'blackboard_read.sh', 'browser_get_active_tab.sh', 'browser_project_match.sh',
  'calendar_check_conflicts.sh', 'calendar_find_free_slots.sh', 'consult_agent.sh',
  'deep_research.sh', 'delegate_to_workflow.sh', 'demo_sh.sh', 'execute_command.sh',
  'execute_sql_code.sh', 'get_current_time.sh', 'get_current_weather.sh', 'gh_issue.sh',
  'log_feedback.sh', 'note_append.sh', 'note_search.sh', 'optimize_instructions.sh',
  'render_ui.sh', 'repo_push.sh', 'repo_summary.sh', 'skill_install.sh',
  'sync_markdown_to_sqlite.sh', 'sync_projects_bidirectional.sh', 'sync_tasks_reminders.sh',
  'vision_analyze_organize.sh', 'workspace_map.sh'
];

let tsCode = `import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TOOLS_DIR = '${srcDir}';

`;

const registrations = [];

for (const script of scripts) {
  const scriptPath = path.join(srcDir, script);
  if (!fs.existsSync(scriptPath)) continue;
  
  const content = fs.readFileSync(scriptPath, 'utf8');
  const lines = content.split('\n');
  
  let description = '';
  const options = [];
  
  for (const line of lines) {
    if (line.startsWith('# @describe')) {
      description += line.replace('# @describe', '').trim() + ' ';
    } else if (line.startsWith('# @option') || line.startsWith('# @arg')) {
      const match = line.match(/# @(?:option|arg) (--?\\w+)(!)?\\s+(.*)/) || line.match(/# @(?:option|arg) ([a-zA-Z0-9_-]+)(!)?\\s+(.*)/);
      if (match) {
        let name = match[1].replace(/^-+/, '');
        // sanitize name for JS
        name = name.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        options.push({
          rawName: match[1],
          name: name,
          required: match[2] === '!',
          desc: match[3].trim()
        });
      }
    }
  }
  
  description = description.trim().replace(/'/g, "\\'");
  if (!description) description = "Executes " + script;
  
  const camelName = script.replace('.sh', '').replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  const InterfaceName = camelName.charAt(0).toUpperCase() + camelName.slice(1) + 'Params';
  
  let zodFields = options.map(opt => {
    let zType = `z.string().describe('${opt.desc.replace(/'/g, "\\'")}')`;
    if (!opt.required) zType += '.optional()';
    return `  ${opt.name}: ${zType},`;
  }).join('\n');
  
  tsCode += `// --- ${script.toUpperCase()} ---\n`;
  tsCode += `const ${InterfaceName} = z.object({\n${zodFields}\n});\n\n`;
  
  let argsString = options.map(opt => {
    if (opt.rawName.startsWith('-')) {
      return `${opt.rawName} \${JSON.stringify(${opt.name} || '')}`;
    } else {
      return `\${JSON.stringify(${opt.name} || '')}`;
    }
  }).join(' ');
  
  let funcArgs = options.length > 0 ? `{ ${options.map(o => o.name).join(', ')} }` : '()';
  
  tsCode += `export const ${camelName}: Tool<typeof ${InterfaceName}> = {
  name: '${script.replace('.sh', '')}',
  description: '${description}',
  parameters: ${InterfaceName},
  execute: async (${funcArgs}) => {
    try {
      const command = \`bash \${TOOLS_DIR}/${script} ${argsString}\`.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

`;
  registrations.push(`toolRegistry.register(${camelName});`);
}

tsCode += registrations.join('\n') + '\n';

fs.writeFileSync(outPath, tsCode);
console.log('Generated systemMisc.ts');
