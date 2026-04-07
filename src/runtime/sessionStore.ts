import { Message, TaskEnvelope, TaskSource } from '../types';

type SessionRole = Extract<Message['role'], 'user' | 'assistant'>;

interface SessionEntry {
  role: SessionRole;
  content: string;
  createdAt: string;
}

export interface SessionSettings {
  model?: string;
  verbosity?: 'low' | 'medium' | 'high';
  approvalMode?: 'standard' | 'strict';
}

export interface SessionRecord {
  key: string;
  source: TaskSource;
  sourceId: string;
  sourceKey: string;
  history: SessionEntry[];
  settings: SessionSettings;
  updatedAt: string;
}

const MAX_SESSION_HISTORY = 12;
const MAX_SOURCE_HISTORY = 20;

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sourceHistory = new Map<string, SessionEntry[]>();

  getSession(task: TaskEnvelope): SessionRecord {
    const key = this.getSessionKey(task);
    const sourceId = task.sourceId || 'default';
    const sourceKey = this.getSourceKey(task.source);
    let session = this.sessions.get(key);

    if (!session) {
      session = {
        key,
        source: task.source,
        sourceId,
        sourceKey,
        history: [],
        settings: {},
        updatedAt: new Date().toISOString(),
      };
      this.sessions.set(key, session);
    }

    return session;
  }

  appendInteraction(task: TaskEnvelope, prompt: string, response: string): void {
    const session = this.getSession(task);
    const userEntry: SessionEntry = { role: 'user', content: prompt.trim(), createdAt: new Date().toISOString() };
    const assistantEntry: SessionEntry = { role: 'assistant', content: response.trim(), createdAt: new Date().toISOString() };

    session.history.push(userEntry, assistantEntry);
    if (session.history.length > MAX_SESSION_HISTORY) {
      session.history.splice(0, session.history.length - MAX_SESSION_HISTORY);
    }
    session.updatedAt = new Date().toISOString();

    const sourceEntries = this.sourceHistory.get(session.sourceKey) ?? [];
    sourceEntries.push(userEntry, assistantEntry);
    if (sourceEntries.length > MAX_SOURCE_HISTORY) {
      sourceEntries.splice(0, sourceEntries.length - MAX_SOURCE_HISTORY);
    }
    this.sourceHistory.set(session.sourceKey, sourceEntries);
  }

  getRecentSessionHistory(task: TaskEnvelope, limit = 6): SessionEntry[] {
    return this.getSession(task).history.slice(-limit);
  }

  getRecentSourceHistory(source: TaskSource, limit = 6): SessionEntry[] {
    const entries = this.sourceHistory.get(this.getSourceKey(source)) ?? [];
    return entries.slice(-limit);
  }

  formatSessionHistory(task: TaskEnvelope, limit = 6): string {
    const entries = this.getRecentSessionHistory(task, limit);
    if (entries.length === 0) {
      return 'No prior session history.';
    }

    return entries.map((entry) => `- ${entry.role}: ${entry.content}`).join('\n');
  }

  formatSourceHistory(source: TaskSource, limit = 6): string {
    const entries = this.getRecentSourceHistory(source, limit);
    if (entries.length === 0) {
      return 'No prior source history.';
    }

    return entries.map((entry) => `- ${entry.role}: ${entry.content}`).join('\n');
  }

  updateSessionSettings(task: TaskEnvelope, partial: Partial<SessionSettings>): SessionSettings {
    const session = this.getSession(task);
    session.settings = {
      ...session.settings,
      ...partial,
    };
    session.updatedAt = new Date().toISOString();
    return session.settings;
  }

  getSessionKey(task: TaskEnvelope): string {
    return `${task.source}:${task.sourceId || 'default'}`;
  }

  getSourceKey(source: TaskSource): string {
    return `source:${source}`;
  }
}

export const sessionStore = new SessionStore();
