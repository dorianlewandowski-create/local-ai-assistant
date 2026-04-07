import { config } from '../config';
import { TaskQueue, TaskQueueSnapshot } from './taskQueue';
import { RuntimeServices } from './services';
import { PendingApprovalCounter } from './appContext';
import { TaskEnvelope } from '../types';

export interface RuntimeStatusSnapshot {
  health: {
    version: string;
    ollamaHost: string;
    remoteSafeMode: boolean;
    pendingApprovals: number;
  };
  queue: TaskQueueSnapshot;
  sessions: {
    count: number;
    recent: ReturnType<RuntimeServices['listSessions']>;
  };
  memory: {
    facts: number;
    vectors: number;
  };
  audit: ReturnType<RuntimeServices['readRecentAudit']>;
}

export interface RuntimePromptSubmission {
  source: TaskEnvelope['source'];
  sourceId: string;
  prompt: string;
}

export interface RuntimeApprovalSummary {
  id: string;
  source: string;
  sourceId?: string;
  toolName: string;
  permissionClass: string;
  reason: string;
  expiresAt?: string;
}

export interface RuntimeApi {
  getStatusSnapshot(): Promise<RuntimeStatusSnapshot>;
  submitPrompt(input: RuntimePromptSubmission): Promise<string>;
  listSessions(limit?: number): ReturnType<RuntimeServices['listSessions']>;
  listPendingApprovals(): RuntimeApprovalSummary[];
  settleApproval(id: string, approved: boolean): boolean;
  getSessionModel(task: TaskEnvelope): string | undefined;
  setSessionModel(task: TaskEnvelope, model: string): void;
  getSessionSandboxMode(task: TaskEnvelope): 'default' | 'strict' | 'off' | undefined;
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off'): void;
  isRemoteSafeModeEnabled(): boolean;
  setRemoteSafeMode(enabled: boolean): void;
  setSessionModelByKey(source: TaskEnvelope['source'], sourceId: string, model: string): void;
  setSessionSandboxModeByKey(source: TaskEnvelope['source'], sourceId: string, mode: 'default' | 'strict' | 'off'): void;
}

export function createRuntimeApi(taskQueue: TaskQueue, approvals: PendingApprovalCounter, services: RuntimeServices): RuntimeApi {
  return {
    async getStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
      return {
        health: {
          version: config.app.version,
          ollamaHost: config.ollama.host,
          remoteSafeMode: services.isRemoteSafeModeEnabled(),
          pendingApprovals: approvals.getPendingApprovalCount(),
        },
        queue: taskQueue.getSnapshot(),
        sessions: {
          count: services.getSessionCount(),
          recent: services.listSessions(10),
        },
        memory: {
          facts: services.countFacts(),
          vectors: await services.countVectors(),
        },
        audit: services.readRecentAudit(20),
      };
    },
    async submitPrompt(input: RuntimePromptSubmission): Promise<string> {
      const task: TaskEnvelope = {
        id: `service-prompt-${Date.now()}`,
        source: input.source,
        sourceId: input.sourceId,
        prompt: input.prompt,
        timeoutMs: 120_000,
      };
      const result = await taskQueue.enqueue(task);
      return result.response;
    },
    listSessions(limit = 10) {
      return services.listSessions(limit);
    },
    listPendingApprovals() {
      return approvals.listPendingApprovals?.() ?? [];
    },
    settleApproval(id: string, approved: boolean) {
      return approvals.settleApproval?.(id, approved) ?? false;
    },
    getSessionModel(task: TaskEnvelope) {
      return services.getSessionModel(task);
    },
    setSessionModel(task: TaskEnvelope, model: string) {
      services.setSessionModel(task, model);
    },
    setSessionModelByKey(source: TaskEnvelope['source'], sourceId: string, model: string) {
      services.setSessionModel({ id: `service-${Date.now()}`, source, sourceId, prompt: '' }, model);
    },
    getSessionSandboxMode(task: TaskEnvelope) {
      return services.getSessionSandboxMode(task);
    },
    setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off') {
      services.setSessionSandboxMode(task, mode);
    },
    setSessionSandboxModeByKey(source: TaskEnvelope['source'], sourceId: string, mode: 'default' | 'strict' | 'off') {
      services.setSessionSandboxMode({ id: `service-${Date.now()}`, source, sourceId, prompt: '' }, mode);
    },
    isRemoteSafeModeEnabled() {
      return services.isRemoteSafeModeEnabled();
    },
    setRemoteSafeMode(enabled: boolean) {
      services.setRemoteSafeMode(enabled);
    },
  };
}
