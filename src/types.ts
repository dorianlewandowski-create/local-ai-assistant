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

export type ToolCategory =
  | 'filesystem'
  | 'memory'
  | 'web'
  | 'calendar'
  | 'browser'
  | 'system'
  | 'automation'
  | 'utility';

export type ToolRiskLevel = 'low' | 'medium' | 'high';

export interface ToolManifest {
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  permissionClass: PermissionClass;
  allowedSources?: TaskSource[];
}

export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  risk?: ToolRiskLevel;
  result?: string;
}

export interface Tool<T extends z.ZodObject<any> = any> {
  name: string;
  description: string;
  category?: ToolCategory;
  riskLevel?: ToolRiskLevel;
  manifest?: ToolManifest;
  parameters: T;
  execute: (args: z.infer<T>, context?: { task: TaskEnvelope }) => Promise<ToolResult | any>;
}

export interface AgentConfig {
  name: string;
  systemPrompt: string;
  tools: string[]; // Names of tools this agent can access
  model: string;
}

export type SubAgentKind = 'researcher' | 'coder' | 'system';

export type TaskSource = 'terminal' | 'file_watcher' | 'whatsapp' | 'telegram' | 'slack' | 'scheduler';
export type PermissionClass = 'read' | 'write' | 'automation' | 'destructive';

export interface TaskEnvelope {
  id: string;
  source: TaskSource;
  sourceId?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  supplementalSystemPrompt?: string;
  trackProactiveNotifications?: boolean;
  timeoutMs?: number;
}

export interface TaskResult {
  taskId: string;
  source: TaskSource;
  agent: string;
  response: string;
}

export interface AuthorizationRequest {
  id: string;
  source: TaskSource;
  sourceId?: string;
  toolName: string;
  command: string;
  reason: string;
  permissionClass: PermissionClass;
  expiresAt?: string;
}

export interface OrchestratorState {
  messages: Message[];
  activeAgent: string;
}
