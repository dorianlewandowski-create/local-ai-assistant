import { readRecentSecurityAudit, SecurityAuditEvent } from '../security/audit';
import { runtimeSecurityState } from '../security/runtimeState';
import { sessionStore, SessionSummary } from './sessionStore';
import { memoryStore } from '../db/memory';
import { vectorStore } from '../db/vectorStore';
import { TaskEnvelope } from '../types';

export interface RuntimeServices {
  getSessionCount(): number;
  listSessions(limit: number): SessionSummary[];
  getSessionModel(task: TaskEnvelope): string | undefined;
  setSessionModel(task: TaskEnvelope, model: string): void;
  getSessionSandboxMode(task: TaskEnvelope): 'default' | 'strict' | 'off' | undefined;
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off'): void;
  countFacts(): number;
  countVectors(): Promise<number>;
  isRemoteSafeModeEnabled(): boolean;
  setRemoteSafeMode(enabled: boolean): void;
  readRecentAudit(limit: number): SecurityAuditEvent[];
}

export const runtimeServices: RuntimeServices = {
  getSessionCount() {
    return sessionStore.count();
  },
  listSessions(limit: number) {
    return sessionStore.listSessions(limit);
  },
  getSessionModel(task: TaskEnvelope) {
    return sessionStore.getSession(task).settings.model;
  },
  setSessionModel(task: TaskEnvelope, model: string) {
    sessionStore.updateSessionSettings(task, { model });
  },
  getSessionSandboxMode(task: TaskEnvelope) {
    return sessionStore.getSession(task).settings.sandboxMode;
  },
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off') {
    sessionStore.updateSessionSettings(task, { sandboxMode: mode });
  },
  countFacts() {
    return memoryStore.count();
  },
  countVectors() {
    return vectorStore.count();
  },
  isRemoteSafeModeEnabled() {
    return runtimeSecurityState.isRemoteSafeModeEnabled();
  },
  setRemoteSafeMode(enabled: boolean) {
    runtimeSecurityState.setRemoteSafeMode(enabled);
  },
  readRecentAudit(limit: number) {
    return readRecentSecurityAudit(limit);
  },
};
