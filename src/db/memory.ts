import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface MemoryRecord {
  id: number;
  fact: string;
  category: string;
  source: string;
  confidence: number;
  created_at: string;
  last_recalled_at: string | null;
  last_notified_at: string | null;
}

export interface SaveFactInput {
  fact: string;
  category?: string;
  source?: string;
  confidence?: number;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'assistant.db');

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath = DEFAULT_DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT 'conversation',
        confidence REAL NOT NULL DEFAULT 0.8,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_recalled_at TEXT,
        last_notified_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
      CREATE INDEX IF NOT EXISTS idx_memory_created_at ON memory(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_last_notified_at ON memory(last_notified_at DESC);
    `);

    const columns = this.db.prepare(`PRAGMA table_info(memory)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'last_notified_at')) {
      this.db.exec(`ALTER TABLE memory ADD COLUMN last_notified_at TEXT`);
    }
  }

  saveFact(input: SaveFactInput): MemoryRecord {
    const fact = input.fact.trim();
    if (!fact) {
      throw new Error('Fact must not be empty.');
    }

    const category = input.category?.trim() || 'general';
    const source = input.source?.trim() || 'conversation';
    const confidence = input.confidence ?? 0.8;

    const existing = this.db.prepare(
      `SELECT * FROM memory WHERE fact = ? ORDER BY id DESC LIMIT 1`
    ).get(fact) as MemoryRecord | undefined;

    if (existing) {
      this.db.prepare(
        `UPDATE memory
         SET category = ?, source = ?, confidence = ?, last_recalled_at = COALESCE(last_recalled_at, CURRENT_TIMESTAMP)
         WHERE id = ?`
      ).run(category, source, confidence, existing.id);

      return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(existing.id) as MemoryRecord;
    }

    const result = this.db.prepare(
      `INSERT INTO memory (fact, category, source, confidence)
       VALUES (?, ?, ?, ?)`
    ).run(fact, category, source, confidence);

    return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(result.lastInsertRowid) as MemoryRecord;
  }

  recallFacts(query: string, limit = 5): MemoryRecord[] {
    const tokens = this.extractTokens(query);

    if (tokens.length === 0) {
      return this.recentFacts(limit);
    }

    const clauses = tokens.map(() => `(fact LIKE ? OR category LIKE ? OR source LIKE ?)`);
    const values = tokens.flatMap((token) => {
      const pattern = `%${token}%`;
      return [pattern, pattern, pattern];
    });

    const rows = this.db.prepare(
      `SELECT *
       FROM memory
       WHERE ${clauses.join(' OR ')}
       ORDER BY COALESCE(last_recalled_at, created_at) DESC, confidence DESC
       LIMIT ?`
    ).all(...values, limit) as MemoryRecord[];

    this.markRecalled(rows.map((row) => row.id));
    return rows;
  }

  recentFacts(limit = 5): MemoryRecord[] {
    const rows = this.db.prepare(
      `SELECT *
       FROM memory
       ORDER BY COALESCE(last_recalled_at, created_at) DESC, confidence DESC
       LIMIT ?`
    ).all(limit) as MemoryRecord[];

    this.markRecalled(rows.map((row) => row.id));
    return rows;
  }

  formatContext(query: string, limit = 5): string {
    const memories = this.recallFacts(query, limit);
    if (memories.length === 0) {
      return 'No relevant long-term memories found.';
    }

    return memories
      .map((memory) => `- [${memory.category}] ${memory.fact}`)
      .join('\n');
  }

  wasRecentlyNotified(fact: string, withinHours = 12): boolean {
    const normalizedFact = fact.trim();
    if (!normalizedFact) {
      return false;
    }

    const row = this.db.prepare(
      `SELECT 1
       FROM memory
       WHERE fact = ?
         AND last_notified_at IS NOT NULL
         AND datetime(last_notified_at) >= datetime('now', ?)
       LIMIT 1`
    ).get(normalizedFact, `-${withinHours} hours`);

    return Boolean(row);
  }

  recentNotifications(limit = 5): MemoryRecord[] {
    return this.db.prepare(
      `SELECT *
       FROM memory
       WHERE last_notified_at IS NOT NULL
       ORDER BY datetime(last_notified_at) DESC
       LIMIT ?`
    ).all(limit) as MemoryRecord[];
  }

  recordNotification(fact: string, category = 'proactive_alert', source = 'notification', confidence = 1): MemoryRecord {
    const memory = this.saveFact({ fact, category, source, confidence });
    this.db.prepare(
      `UPDATE memory
       SET last_notified_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(memory.id);

    return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(memory.id) as MemoryRecord;
  }

  formatRecentNotificationContext(limit = 5): string {
    const notifications = this.recentNotifications(limit);
    if (notifications.length === 0) {
      return 'No recent proactive alerts have been sent.';
    }

    return notifications
      .map((notification) => `- ${notification.fact} (last notified at ${notification.last_notified_at ?? 'unknown time'})`)
      .join('\n');
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM memory`).get() as { count: number };
    return row.count;
  }

  private markRecalled(ids: number[]) {
    if (ids.length === 0) {
      return;
    }

    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(
      `UPDATE memory SET last_recalled_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  private extractTokens(query: string): string[] {
    return Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 4)
      )
    ).slice(0, 8);
  }
}

export const memoryStore = new MemoryStore();
