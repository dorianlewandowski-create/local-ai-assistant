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

export interface RuntimeApi {
  getStatusSnapshot(): Promise<RuntimeStatusSnapshot>;
  getSessionModel(task: TaskEnvelope): string | undefined;
  setSessionModel(task: TaskEnvelope, model: string): void;
  getSessionSandboxMode(task: TaskEnvelope): 'default' | 'strict' | 'off' | undefined;
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off'): void;
  isRemoteSafeModeEnabled(): boolean;
  setRemoteSafeMode(enabled: boolean): void;
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
    getSessionModel(task: TaskEnvelope) {
      return services.getSessionModel(task);
    },
    setSessionModel(task: TaskEnvelope, model: string) {
      services.setSessionModel(task, model);
    },
    getSessionSandboxMode(task: TaskEnvelope) {
      return services.getSessionSandboxMode(task);
    },
    setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off') {
      services.setSessionSandboxMode(task, mode);
    },
    isRemoteSafeModeEnabled() {
      return services.isRemoteSafeModeEnabled();
    },
    setRemoteSafeMode(enabled: boolean) {
      services.setRemoteSafeMode(enabled);
    },
  };
}
