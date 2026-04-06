import { z } from 'zod';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool<T extends z.ZodObject<any> = any> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>) => Promise<any>;
}

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  tools: string[]; // Names of tools this agent can access
  model: string;
}

export type SubAgentKind = 'researcher' | 'coder' | 'system';

export type TaskSource = 'terminal' | 'file_watcher' | 'whatsapp' | 'telegram' | 'slack' | 'scheduler';

export interface TaskEnvelope {
  id: string;
  source: TaskSource;
  sourceId?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  supplementalSystemPrompt?: string;
  trackProactiveNotifications?: boolean;
}

export interface TaskResult {
  taskId: string;
  source: TaskSource;
  agent: string;
  response: string;
}

export interface OrchestratorState {
  messages: Message[];
  activeAgent: string;
}
