import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { exec } from 'child_process';
import { promisify } from 'util';
import { sendNotification } from '../utils/notifier';

const execAsync = promisify(exec);
const TOOLS_DIR = '/Users/dorianlewandowski/local-ai-assistant/ai-tools/llm-functions/tools';

// --- AUTO_DOCUMENT.SH ---
const AutoDocumentParams = z.object({

});

export const autoDocument: Tool<typeof AutoDocumentParams> = {
  name: 'auto_document',
  description: 'Automatically update the README.md based on current tools and agents.',
  parameters: AutoDocumentParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/auto_document.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- AUTONOMOUS_FIX.SH ---
const AutonomousFixParams = z.object({

});

export const autonomousFix: Tool<typeof AutonomousFixParams> = {
  name: 'autonomous_fix',
  description: 'Autonomous debugging loop: Run a command, capture error, fix code, and repeat.',
  parameters: AutonomousFixParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/autonomous_fix.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- BLACKBOARD_CLEAR.SH ---
const BlackboardClearParams = z.object({

});

export const blackboardClear: Tool<typeof BlackboardClearParams> = {
  name: 'blackboard_clear',
  description: 'Clear entries from the shared agent blackboard.',
  parameters: BlackboardClearParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/blackboard_clear.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- BLACKBOARD_POST.SH ---
const BlackboardPostParams = z.object({

});

export const blackboardPost: Tool<typeof BlackboardPostParams> = {
  name: 'blackboard_post',
  description: 'Post information to the shared agent blackboard.',
  parameters: BlackboardPostParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/blackboard_post.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- BLACKBOARD_READ.SH ---
const BlackboardReadParams = z.object({

});

export const blackboardRead: Tool<typeof BlackboardReadParams> = {
  name: 'blackboard_read',
  description: 'Read information from the shared agent blackboard.',
  parameters: BlackboardReadParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/blackboard_read.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- BROWSER_GET_ACTIVE_TAB.SH ---
const BrowserGetActiveTabParams = z.object({

});

export const browserGetActiveTab: Tool<typeof BrowserGetActiveTabParams> = {
  name: 'browser_get_active_tab',
  description: 'Get the URL and title of the active tab in Safari or Chrome.',
  parameters: BrowserGetActiveTabParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/browser_get_active_tab.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- BROWSER_PROJECT_MATCH.SH ---
const BrowserProjectMatchParams = z.object({

});

export const browserProjectMatch: Tool<typeof BrowserProjectMatchParams> = {
  name: 'browser_project_match',
  description: 'Check if the active browser tab relates to any active project.',
  parameters: BrowserProjectMatchParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/browser_project_match.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CALENDAR_CHECK_CONFLICTS.SH ---
const CalendarCheckConflictsParams = z.object({

});

export const calendarCheckConflicts: Tool<typeof CalendarCheckConflictsParams> = {
  name: 'calendar_check_conflicts',
  description: 'Check for calendar conflicts within a given time range.',
  parameters: CalendarCheckConflictsParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/calendar_check_conflicts.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CALENDAR_FIND_FREE_SLOTS.SH ---
const CalendarFindFreeSlotsParams = z.object({

});

export const calendarFindFreeSlots: Tool<typeof CalendarFindFreeSlotsParams> = {
  name: 'calendar_find_free_slots',
  description: 'Find free time slots on a given date.',
  parameters: CalendarFindFreeSlotsParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/calendar_find_free_slots.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- CONSULT_AGENT.SH ---
const ConsultAgentParams = z.object({

});

export const consultAgent: Tool<typeof ConsultAgentParams> = {
  name: 'consult_agent',
  description: 'Consult another specialist agent for an opinion or information.',
  parameters: ConsultAgentParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/consult_agent.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- DEEP_RESEARCH.SH ---
const DeepResearchParams = z.object({

});

export const deepResearch: Tool<typeof DeepResearchParams> = {
  name: 'deep_research',
  description: 'Perform a deep, multi-turn autonomous research investigation.',
  parameters: DeepResearchParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/deep_research.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- DELEGATE_TO_WORKFLOW.SH ---
const DelegateToWorkflowParams = z.object({

});

export const delegateToWorkflow: Tool<typeof DelegateToWorkflowParams> = {
  name: 'delegate_to_workflow',
  description: 'Delegate a complex, multi-step request to the Workflow Agent.',
  parameters: DelegateToWorkflowParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/delegate_to_workflow.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- DEMO_SH.SH ---
const DemoShParams = z.object({

});

export const demoSh: Tool<typeof DemoShParams> = {
  name: 'demo_sh',
  description: 'Demonstrate how to create a tool using Bash and how to use comment tags.',
  parameters: DemoShParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/demo_sh.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- EXECUTE_COMMAND.SH ---
const ExecuteCommandParams = z.object({

});

export const executeCommand: Tool<typeof ExecuteCommandParams> = {
  name: 'execute_command',
  description: 'Execute the shell command.',
  parameters: ExecuteCommandParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/execute_command.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- EXECUTE_SQL_CODE.SH ---
const ExecuteSqlCodeParams = z.object({

});

export const executeSqlCode: Tool<typeof ExecuteSqlCodeParams> = {
  name: 'execute_sql_code',
  description: 'Execute the sql code.',
  parameters: ExecuteSqlCodeParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/execute_sql_code.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- GET_CURRENT_TIME.SH ---
const GetCurrentTimeParams = z.object({

});

export const getCurrentTime: Tool<typeof GetCurrentTimeParams> = {
  name: 'get_current_time',
  description: 'Get the current time.',
  parameters: GetCurrentTimeParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/get_current_time.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- GET_CURRENT_WEATHER.SH ---
const GetCurrentWeatherParams = z.object({
  location: z.string()
    .min(1, 'Location is required.')
    .describe('Required. The city name, optionally including state or country, such as "London" or "San Francisco, CA". Do not leave this empty.'),
});

export const getCurrentWeather: Tool<typeof GetCurrentWeatherParams> = {
  name: 'get_current_weather',
  description: 'Get the current weather in a given location.',
  parameters: GetCurrentWeatherParams,
  execute: async ({ location }) => {
    try {
      const command = `bash ${JSON.stringify(`${TOOLS_DIR}/get_current_weather.sh`)} --location ${JSON.stringify(location)}`;
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- GH_ISSUE.SH ---
const GhIssueParams = z.object({

});

export const ghIssue: Tool<typeof GhIssueParams> = {
  name: 'gh_issue',
  description: 'Create a GitHub issue in the current repository.',
  parameters: GhIssueParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/gh_issue.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- LOG_FEEDBACK.SH ---
const LogFeedbackParams = z.object({

});

export const logFeedback: Tool<typeof LogFeedbackParams> = {
  name: 'log_feedback',
  description: 'Log user feedback and corrections for future self-optimization.',
  parameters: LogFeedbackParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/log_feedback.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- NOTE_APPEND.SH ---
const NoteAppendParams = z.object({

});

export const noteAppend: Tool<typeof NoteAppendParams> = {
  name: 'note_append',
  description: 'Executes note_append.sh',
  parameters: NoteAppendParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/note_append.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- NOTE_SEARCH.SH ---
const NoteSearchParams = z.object({

});

export const noteSearch: Tool<typeof NoteSearchParams> = {
  name: 'note_search',
  description: 'Executes note_search.sh',
  parameters: NoteSearchParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/note_search.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- OPTIMIZE_INSTRUCTIONS.SH ---
const OptimizeInstructionsParams = z.object({

});

export const optimizeInstructions: Tool<typeof OptimizeInstructionsParams> = {
  name: 'optimize_instructions',
  description: 'Autonomously optimize agent instructions based on collected user feedback.',
  parameters: OptimizeInstructionsParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/optimize_instructions.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- RENDER_UI.SH ---
const RenderUiParams = z.object({

});

export const renderUi: Tool<typeof RenderUiParams> = {
  name: 'render_ui',
  description: 'Render professional terminal UI components (panels, tables, markdown).',
  parameters: RenderUiParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/render_ui.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- REPO_PUSH.SH ---
const RepoPushParams = z.object({

});

export const repoPush: Tool<typeof RepoPushParams> = {
  name: 'repo_push',
  description: 'Stage changes, generate an AI commit message, and push to GitHub.',
  parameters: RepoPushParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/repo_push.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- REPO_SUMMARY.SH ---
const RepoSummaryParams = z.object({

});

export const repoSummary: Tool<typeof RepoSummaryParams> = {
  name: 'repo_summary',
  description: 'Get a summary of recent commits and open GitHub issues.',
  parameters: RepoSummaryParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/repo_summary.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SKILL_INSTALL.SH ---
const SkillInstallParams = z.object({

});

export const skillInstall: Tool<typeof SkillInstallParams> = {
  name: 'skill_install',
  description: 'Formally install a new AI-generated tool into the system.',
  parameters: SkillInstallParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/skill_install.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SEND_SYSTEM_NOTIFICATION ---
const SendSystemNotificationParams = z.object({
  message: z.string().min(1, 'Message is required.').describe('The visible notification body shown to the user. Keep it concise and action-oriented.'),
  title: z.string().optional().describe('Optional notification title. Defaults to "AI Assistant".'),
  subtitle: z.string().optional().describe('Optional notification subtitle describing the action taken. Defaults to "Action taken".'),
});

export const sendSystemNotification: Tool<typeof SendSystemNotificationParams> = {
  name: 'send_system_notification',
  description: 'Show a macOS system notification to inform the user about an autonomous action or important update.',
  parameters: SendSystemNotificationParams,
  execute: async ({ message, title, subtitle }) => {
    try {
      await sendNotification({ message, title, subtitle });
      return { success: true, result: `Notification sent: ${message}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SYNC_MARKDOWN_TO_SQLITE.SH ---
const SyncMarkdownToSqliteParams = z.object({

});

export const syncMarkdownToSqlite: Tool<typeof SyncMarkdownToSqliteParams> = {
  name: 'sync_markdown_to_sqlite',
  description: 'Sync project notes in Markdown to the SQLite assistant database.',
  parameters: SyncMarkdownToSqliteParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/sync_markdown_to_sqlite.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SYNC_PROJECTS_BIDIRECTIONAL.SH ---
const SyncProjectsBidirectionalParams = z.object({

});

export const syncProjectsBidirectional: Tool<typeof SyncProjectsBidirectionalParams> = {
  name: 'sync_projects_bidirectional',
  description: 'Bidirectional sync between project Markdown notes and SQLite assistant database.',
  parameters: SyncProjectsBidirectionalParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/sync_projects_bidirectional.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- SYNC_TASKS_REMINDERS.SH ---
const SyncTasksRemindersParams = z.object({

});

export const syncTasksReminders: Tool<typeof SyncTasksRemindersParams> = {
  name: 'sync_tasks_reminders',
  description: 'Sync open SQLite tasks with Apple Reminders.',
  parameters: SyncTasksRemindersParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/sync_tasks_reminders.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- VISION_ANALYZE_ORGANIZE.SH ---
const VisionAnalyzeOrganizeParams = z.object({

});

export const visionAnalyzeOrganize: Tool<typeof VisionAnalyzeOrganizeParams> = {
  name: 'vision_analyze_organize',
  description: 'Use vision analysis to categorize and organize a file into project or research assets.',
  parameters: VisionAnalyzeOrganizeParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/vision_analyze_organize.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

// --- WORKSPACE_MAP.SH ---
const WorkspaceMapParams = z.object({

});

export const workspaceMap: Tool<typeof WorkspaceMapParams> = {
  name: 'workspace_map',
  description: 'Analyze a project directory to identify its structure, tech stack, and entry points.',
  parameters: WorkspaceMapParams,
  execute: async () => {
    try {
      const command = `bash ${TOOLS_DIR}/workspace_map.sh `.trim();
      const { stdout } = await execAsync(command);
      return { success: true, result: stdout.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(autoDocument);
toolRegistry.register(autonomousFix);
toolRegistry.register(blackboardClear);
toolRegistry.register(blackboardPost);
toolRegistry.register(blackboardRead);
toolRegistry.register(browserGetActiveTab);
toolRegistry.register(browserProjectMatch);
toolRegistry.register(calendarCheckConflicts);
toolRegistry.register(calendarFindFreeSlots);
toolRegistry.register(consultAgent);
toolRegistry.register(deepResearch);
toolRegistry.register(delegateToWorkflow);
toolRegistry.register(demoSh);
toolRegistry.register(executeCommand);
toolRegistry.register(executeSqlCode);
toolRegistry.register(getCurrentTime);
toolRegistry.register(getCurrentWeather);
toolRegistry.register(ghIssue);
toolRegistry.register(logFeedback);
toolRegistry.register(noteAppend);
toolRegistry.register(noteSearch);
toolRegistry.register(optimizeInstructions);
toolRegistry.register(renderUi);
toolRegistry.register(repoPush);
toolRegistry.register(repoSummary);
toolRegistry.register(skillInstall);
toolRegistry.register(sendSystemNotification);
toolRegistry.register(syncMarkdownToSqlite);
toolRegistry.register(syncProjectsBidirectional);
toolRegistry.register(syncTasksReminders);
toolRegistry.register(visionAnalyzeOrganize);
toolRegistry.register(workspaceMap);
