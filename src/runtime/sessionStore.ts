import fs from 'fs';
import path from 'path';
import { Message, TaskEnvelope, TaskSource } from '../types';
import { config } from '../config';

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
  allowedTools?: string[];
  blockedTools?: string[];
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

export interface SessionSummary {
  key: string;
  source: TaskSource;
  sourceId: string;
  updatedAt: string;
  historyCount: number;
  settings: SessionSettings;
}

interface PersistedSessionState {
  sessions: SessionRecord[];
  sourceHistory: Array<[string, SessionEntry[]]>;
}

const MAX_SESSION_HISTORY = 12;
const MAX_SOURCE_HISTORY = 20;

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sourceHistory = new Map<string, SessionEntry[]>();
  constructor(
    private readonly filePath = config.storage.sessionStorePath,
    private readonly maxSessions = config.sessions.maxPersistedSessions,
  ) {}

  async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSessionState;

      this.sessions.clear();
      for (const session of parsed.sessions ?? []) {
        this.sessions.set(session.key, {
          ...session,
          history: Array.isArray(session.history) ? session.history.slice(-MAX_SESSION_HISTORY) : [],
          settings: session.settings ?? {},
        });
      }

      this.sourceHistory.clear();
      for (const [key, entries] of parsed.sourceHistory ?? []) {
      this.sourceHistory.set(key, Array.isArray(entries) ? entries.slice(-MAX_SOURCE_HISTORY) : []);
      }

      this.pruneToLimit();
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  getSession(task: TaskEnvelope): SessionRecord {
    const key = this.getSessionKey(task);
    const sourceId = task.sourceId || 'default';
    const sourceKey = this.getSourceKey(task.source);
    let session = this.sessions.get(key);

    if (!session) {
      this.evictBeforeCreate();
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
    this.persistToDisk();
  }

  getRecentSessionHistory(task: TaskEnvelope, limit = 6): SessionEntry[] {
    return this.getSession(task).history.slice(-limit);
  }

  hasSession(task: TaskEnvelope): boolean {
    return this.sessions.has(this.getSessionKey(task));
  }

  getRecentSourceHistory(source: TaskSource, limit = 6): SessionEntry[] {
    const entries = this.sourceHistory.get(this.getSourceKey(source)) ?? [];
    return entries.slice(-limit);
  }

  formatSessionHistory(task: TaskEnvelope, limit = 6): string {
    if (!this.hasSession(task)) {
      return 'No prior session history.';
    }

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
    this.persistToDisk();
    return session.settings;
  }

  getSessionKey(task: TaskEnvelope): string {
    return `${task.source}:${task.sourceId || 'default'}`;
  }

  getSourceKey(source: TaskSource): string {
    return `source:${source}`;
  }

  count(): number {
    return this.sessions.size;
  }

  listSessions(limit = 10): SessionSummary[] {
    return Array.from(this.sessions.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map((session) => ({
        key: session.key,
        source: session.source,
        sourceId: session.sourceId,
        updatedAt: session.updatedAt,
        historyCount: session.history.length,
        settings: session.settings,
      }));
  }

  private evictBeforeCreate(): void {
    while (this.sessions.size >= this.maxSessions) {
      const oldest = Array.from(this.sessions.values())
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];

      if (!oldest) {
        break;
      }

      this.sessions.delete(oldest.key);
    }
  }

  private pruneToLimit(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldest = Array.from(this.sessions.values())
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];

      if (!oldest) {
        break;
      }

      this.sessions.delete(oldest.key);
    }
  }

  private persistToDisk(): void {
    const payload: PersistedSessionState = {
      sessions: Array.from(this.sessions.values())
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .slice(-this.maxSessions),
      sourceHistory: Array.from(this.sourceHistory.entries()).map(([key, entries]) => [key, entries.slice(-MAX_SOURCE_HISTORY)]),
    };

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }
}

export const sessionStore = new SessionStore();
