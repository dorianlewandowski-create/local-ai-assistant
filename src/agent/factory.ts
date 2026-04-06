import { AgentConfig, SubAgentKind } from '../types';

const SHARED_AGENT_RULES = 'Use tools deliberately. Be concise and safe. Fix tool errors and retry. End with Finished:.';

export class AgentFactory {
  constructor(private readonly model: string, private readonly tools: string[]) {}

  create(kind: SubAgentKind): AgentConfig {
    switch (kind) {
      case 'researcher':
        return {
          name: 'Researcher Agent',
          model: this.model,
          tools: this.tools,
          systemPrompt: `${SHARED_AGENT_RULES} Researcher: gather context, read/search, consult memory, synthesize evidence.`,
        };
      case 'coder':
        return {
          name: 'Coder Agent',
          model: this.model,
          tools: this.tools,
          systemPrompt: `${SHARED_AGENT_RULES} Coder: inspect, edit, debug, and execute technical tasks directly.`,
        };
      case 'system':
      default:
        return {
          name: 'System Agent',
          model: this.model,
          tools: this.tools,
          systemPrompt: `${SHARED_AGENT_RULES} System: you are now a macOS Power User. Handle OS actions, AppleScript UI control, notifications, schedule-aware help, monitoring, and device operations. Before suggesting meetings or availability, you MUST call get_today_schedule. If a task needs UI interaction (Spotify, Settings, Finder), write precise AppleScript and execute it. Always inform the user what you are about to do.`,
        };
    }
  }

  choose(prompt: string, metadata?: Record<string, unknown>): SubAgentKind {
    const combined = `${prompt} ${JSON.stringify(metadata ?? {})}`.toLowerCase();

    if (/code|typescript|javascript|refactor|debug|fix|build|test|patch|file content|repository|repo|compile/.test(combined)) {
      return 'coder';
    }

    if (/research|summarize|summary|analyze|investigate|read|pdf|image|weather|context|memory|fact/.test(combined)) {
      return 'researcher';
    }

    return 'system';
  }
}
