import Database from 'better-sqlite3'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { connect, type Connection, type Table } from '@lancedb/lancedb'

export type MemoryLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'system'

export interface MemoryLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  system(message: string): void
}

function createDefaultLogger(): MemoryLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
    system: () => undefined,
  }
}

// ---------------------------
// Checkpoints (rollback/commit)
// ---------------------------

const DEFAULT_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups')

export interface Transaction {
  id: string
  files: Array<{ original: string; backup: string }>
}

export class TransactionManager {
  private activeTransactions = new Map<string, Transaction>()
  private readonly backupDir: string
  private readonly logger: MemoryLogger

  constructor(options?: { backupDir?: string; logger?: MemoryLogger }) {
    this.backupDir = options?.backupDir ?? DEFAULT_BACKUP_DIR
    this.logger = options?.logger ?? createDefaultLogger()
  }

  async startTransaction(id: string, filePaths: string[]): Promise<void> {
    const transaction: Transaction = { id, files: [] }
    const tDir = path.join(this.backupDir, id)
    await fsp.mkdir(tDir, { recursive: true })

    for (const filePath of filePaths) {
      try {
        const absolutePath = path.resolve(filePath)
        const fileName = path.basename(absolutePath)
        const backupPath = path.join(tDir, `${Date.now()}_${fileName}`)

        await fsp.access(absolutePath)
        await fsp.copyFile(absolutePath, backupPath)

        transaction.files.push({ original: absolutePath, backup: backupPath })
        this.logger.debug(`[Transaction] Backed up ${absolutePath} to ${backupPath}`)
      } catch (error: any) {
        this.logger.warn(`[Transaction] Could not backup ${filePath}: ${error?.message ?? String(error)}`)
      }
    }

    this.activeTransactions.set(id, transaction)
  }

  async rollback(id: string): Promise<string[]> {
    const transaction = this.activeTransactions.get(id)
    if (!transaction) throw new Error(`Transaction ${id} not found.`)

    const restored: string[] = []
    for (const { original, backup } of transaction.files) {
      await fsp.copyFile(backup, original)
      restored.push(original)
    }

    this.activeTransactions.delete(id)
    return restored
  }

  async commit(id: string): Promise<void> {
    const transaction = this.activeTransactions.get(id)
    if (!transaction) return

    const tDir = path.join(this.backupDir, id)
    await fsp.rm(tDir, { recursive: true, force: true })

    this.activeTransactions.delete(id)
    this.logger.debug(`[Transaction] Committed ${id}`)
  }
}

// ---------------------------
// Tiered HOT/WARM/COLD memory
// ---------------------------

const DEFAULT_SOUL_ROOT_DIR = path.join(process.cwd(), 'data', 'self-improving')

export interface TieredSoulStorePaths {
  rootDir: string
  hotPath: string
  correctionsPath: string
  reflectionsPath: string
}

function resolveSoulPaths(rootDir: string): TieredSoulStorePaths {
  return {
    rootDir,
    hotPath: path.join(rootDir, 'memory.md'),
    correctionsPath: path.join(rootDir, 'corrections.md'),
    reflectionsPath: path.join(rootDir, 'reflections.md'),
  }
}

const DEFAULT_HOT_MEMORY = `# 🧠 Apex HOT Memory

## Identity
You are Apex, a high-performance, native macOS intelligence layer. Built for speed, secured by kernel-level sandboxing, and driven by Apple Silicon.

## Confirmed Preferences
- Preferred language: English
- Interaction style: Professional and concise
- Tool Preference: Prioritize native macOS Shortcuts.
- Safety: Always use checkpoints for complex tasks.

## Learning Rules
- Pattern used 3x in 7 days → promote to HOT.
- Pattern unused 30 days → demote to WARM.
`

export class TieredSoulStore {
  private hotMemory: string | null = null
  private readonly paths: TieredSoulStorePaths
  private readonly logger: MemoryLogger

  constructor(options?: { rootDir?: string; logger?: MemoryLogger }) {
    const rootDir = options?.rootDir ?? DEFAULT_SOUL_ROOT_DIR
    this.paths = resolveSoulPaths(rootDir)
    this.logger = options?.logger ?? createDefaultLogger()
  }

  async init(): Promise<void> {
    await fsp.mkdir(path.join(this.paths.rootDir, 'projects'), { recursive: true })
    await fsp.mkdir(path.join(this.paths.rootDir, 'domains'), { recursive: true })
    await fsp.mkdir(path.join(this.paths.rootDir, 'archive'), { recursive: true })

    if (!(await this.exists(this.paths.hotPath))) {
      await fsp.writeFile(this.paths.hotPath, DEFAULT_HOT_MEMORY)
    }
    if (!(await this.exists(this.paths.correctionsPath))) {
      await fsp.writeFile(this.paths.correctionsPath, '# 🛠️ Corrections Log\n')
    }
    if (!(await this.exists(this.paths.reflectionsPath))) {
      await fsp.writeFile(this.paths.reflectionsPath, '# 🧘 Self-Reflections\n')
    }
  }

  async loadContextualMemory(context?: string): Promise<string> {
    if (!this.hotMemory) {
      this.hotMemory = await fsp.readFile(this.paths.hotPath, 'utf-8')
    }

    let warmMemory = ''
    if (context) {
      warmMemory = await this.findWarmMemory(context)
    }

    return `--- HOT MEMORY ---\n${this.hotMemory}\n\n--- WARM CONTEXTUAL MEMORY ---\n${warmMemory || 'No specific contextual patterns found.'}`
  }

  async logCorrection(context: string, correction: string): Promise<void> {
    const entry = `\n### [${new Date().toISOString()}] ${context}\n- ERROR: ${correction}\n`
    await fsp.appendFile(this.paths.correctionsPath, entry)
    this.logger.system('Correction logged to memory.')
  }

  async logReflection(context: string, reflection: string, lesson: string): Promise<void> {
    const entry = `\n### [${new Date().toISOString()}] ${context}\n- REFLECTION: ${reflection}\n- LESSON: ${lesson}\n`
    await fsp.appendFile(this.paths.reflectionsPath, entry)
    this.logger.system('Self-reflection logged.')
  }

  async updateHotMemory(content: string): Promise<void> {
    this.hotMemory = content
    await fsp.writeFile(this.paths.hotPath, content)
    this.logger.system('HOT memory updated.')
  }

  // Legacy support for old SoulStore interface
  async load(): Promise<string> {
    return this.loadContextualMemory()
  }

  async save(content: string): Promise<void> {
    await this.updateHotMemory(content)
  }

  private async findWarmMemory(context: string): Promise<string> {
    const dirs = ['projects', 'domains']
    let combined = ''

    for (const dir of dirs) {
      try {
        const files = await fsp.readdir(path.join(this.paths.rootDir, dir))
        for (const file of files) {
          if (file.endsWith('.md') && context.toLowerCase().includes(file.replace('.md', '').toLowerCase())) {
            const content = await fsp.readFile(path.join(this.paths.rootDir, dir, file), 'utf-8')
            combined += `\n[From ${dir}/${file}]:\n${content}\n`
          }
        }
      } catch {
        // ignore missing dirs
      }
    }
    return combined
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fsp.access(p)
      return true
    } catch {
      return false
    }
  }
}

// ---------------------------
// Durable fact memory (sqlite)
// ---------------------------

export interface MemoryRecord {
  id: number
  fact: string
  category: string
  source: string
  confidence: number
  created_at: string
  last_recalled_at: string | null
  last_notified_at: string | null
}

export interface SaveFactInput {
  fact: string
  category?: string
  source?: string
  confidence?: number
}

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'assistant.db')

export class MemoryStore {
  private db: Database.Database

  constructor(dbPath = DEFAULT_DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
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
    `)

    const columns = this.db.prepare(`PRAGMA table_info(memory)`).all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'last_notified_at')) {
      this.db.exec(`ALTER TABLE memory ADD COLUMN last_notified_at TEXT`)
    }
  }

  saveFact(input: SaveFactInput): MemoryRecord {
    const fact = input.fact.trim()
    if (!fact) {
      throw new Error('Fact must not be empty.')
    }

    const category = input.category?.trim() || 'general'
    const source = input.source?.trim() || 'conversation'
    const confidence = input.confidence ?? 0.8

    const existing = this.db
      .prepare(`SELECT * FROM memory WHERE fact = ? ORDER BY id DESC LIMIT 1`)
      .get(fact) as MemoryRecord | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE memory
         SET category = ?, source = ?, confidence = ?
         WHERE id = ?`,
        )
        .run(category, source, confidence, existing.id)

      return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(existing.id) as MemoryRecord
    }

    const result = this.db
      .prepare(
        `INSERT INTO memory (fact, category, source, confidence)
       VALUES (?, ?, ?, ?)`,
      )
      .run(fact, category, source, confidence)

    return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(result.lastInsertRowid) as MemoryRecord
  }

  recallFacts(query: string, limit = 5): MemoryRecord[] {
    const tokens = this.extractTokens(query)

    if (tokens.length === 0) {
      return this.recentFacts(limit)
    }

    const clauses = tokens.map(() => `(fact LIKE ? OR category LIKE ? OR source LIKE ?)`)
    const values = tokens.flatMap((token) => {
      const pattern = `%${token}%`
      return [pattern, pattern, pattern]
    })

    const rows = this.db
      .prepare(
        `SELECT *
       FROM memory
       WHERE ${clauses.join(' OR ')}
       ORDER BY COALESCE(last_recalled_at, created_at) DESC, confidence DESC
       LIMIT ?`,
      )
      .all(...values, limit) as MemoryRecord[]

    this.markRecalled(rows.map((row) => row.id))
    return rows
  }

  recentFacts(limit = 5): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
       FROM memory
       ORDER BY COALESCE(last_recalled_at, created_at) DESC, confidence DESC
       LIMIT ?`,
      )
      .all(limit) as MemoryRecord[]

    this.markRecalled(rows.map((row) => row.id))
    return rows
  }

  formatContext(query: string, limit = 5): string {
    const memories = this.recallFacts(query, limit)
    if (memories.length === 0) {
      return 'No relevant long-term memories found.'
    }

    return memories.map((memory) => `- [${memory.category}] ${memory.fact}`).join('\n')
  }

  wasRecentlyNotified(fact: string, withinHours = 12): boolean {
    const normalizedFact = fact.trim()
    if (!normalizedFact) {
      return false
    }

    const row = this.db
      .prepare(
        `SELECT 1
       FROM memory
       WHERE fact = ?
         AND last_notified_at IS NOT NULL
         AND datetime(last_notified_at) >= datetime('now', ?)
       LIMIT 1`,
      )
      .get(normalizedFact, `-${withinHours} hours`)

    return Boolean(row)
  }

  recentNotifications(limit = 5): MemoryRecord[] {
    return this.db
      .prepare(
        `SELECT *
       FROM memory
       WHERE last_notified_at IS NOT NULL
       ORDER BY datetime(last_notified_at) DESC
       LIMIT ?`,
      )
      .all(limit) as MemoryRecord[]
  }

  recordNotification(
    fact: string,
    category = 'proactive_alert',
    source = 'notification',
    confidence = 1,
  ): MemoryRecord {
    const memory = this.saveFact({ fact, category, source, confidence })
    this.db
      .prepare(
        `UPDATE memory
       SET last_notified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      )
      .run(memory.id)

    return this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(memory.id) as MemoryRecord
  }

  formatRecentNotificationContext(limit = 5): string {
    const notifications = this.recentNotifications(limit)
    if (notifications.length === 0) {
      return 'No recent proactive alerts have been sent.'
    }

    return notifications
      .map(
        (notification) =>
          `- ${notification.fact} (last notified at ${notification.last_notified_at ?? 'unknown time'})`,
      )
      .join('\n')
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM memory`).get() as { count: number }
    return row.count
  }

  private markRecalled(ids: number[]) {
    if (ids.length === 0) {
      return
    }

    const placeholders = ids.map(() => '?').join(', ')
    this.db
      .prepare(`UPDATE memory SET last_recalled_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`)
      .run(...ids)
  }

  private extractTokens(query: string): string[] {
    return Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 4),
      ),
    ).slice(0, 8)
  }
}

// ---------------------------
// Clean API facade
// ---------------------------

export class ApexMemory {
  readonly soul: TieredSoulStore
  readonly facts: MemoryStore
  readonly checkpoints: TransactionManager

  constructor(options?: {
    soulRootDir?: string
    backupsDir?: string
    dbPath?: string
    logger?: MemoryLogger
  }) {
    const logger = options?.logger
    this.soul = new TieredSoulStore({ rootDir: options?.soulRootDir, logger })
    this.facts = new MemoryStore(options?.dbPath)
    this.checkpoints = new TransactionManager({ backupDir: options?.backupsDir, logger })
  }

  async init(): Promise<void> {
    await this.soul.init()
  }
}

// ---------------------------
// Cold tier: Vector memory (LanceDB)
// ---------------------------

export interface VectorRecordInput {
  source: string
  scope: 'file' | 'chat' | 'memory' | 'gateway'
  content: string
  metadata?: Record<string, unknown>
}

export type VectorMatch = {
  source: string
  scope: string
  content: string
  metadata: Record<string, unknown>
}

type VectorRow = {
  id: string
  source: string
  scope: string
  content: string
  metadata: string
  vector: number[]
  createdAt: string
}

export type VectorEmbedder = (input: string) => Promise<number[]>

export interface VectorStoreOptions {
  dbPath: string
  fallbackDbPath?: string
  tableName?: string
  maxContentLength?: number
  embed: VectorEmbedder
}

function resolveVectorDbPath(
  preferredPath: string,
  fallbackPath: string,
): { dbPath: string; preferredPath: string } {
  try {
    fs.mkdirSync(preferredPath, { recursive: true })
    fs.accessSync(preferredPath, fs.constants.R_OK | fs.constants.W_OK)
    return { dbPath: preferredPath, preferredPath }
  } catch {
    fs.mkdirSync(fallbackPath, { recursive: true })
    fs.accessSync(fallbackPath, fs.constants.R_OK | fs.constants.W_OK)
    console.warn(`Vector store path '${preferredPath}' is not writable. Falling back to '${fallbackPath}'.`)
    return { dbPath: fallbackPath, preferredPath }
  }
}

export class VectorStore {
  private connectionPromise: Promise<Connection> | null = null
  private tablePromise: Promise<Table> | null = null
  private writeCount = 0
  private readonly dbPath: string
  private readonly preferredPath: string
  private readonly fallbackDbPath: string
  private readonly tableName: string
  private readonly maxContentLength: number
  private readonly embed: VectorEmbedder

  constructor(options: VectorStoreOptions) {
    this.fallbackDbPath = options.fallbackDbPath ?? path.join(process.cwd(), 'data', 'lancedb')
    const resolved = resolveVectorDbPath(options.dbPath, this.fallbackDbPath)
    this.preferredPath = resolved.preferredPath
    this.dbPath = resolved.dbPath
    this.tableName = options.tableName ?? 'knowledge_chunks'
    this.maxContentLength = options.maxContentLength ?? 12_000
    this.embed = options.embed
  }

  getPath(): string {
    return this.dbPath
  }

  isUsingFallbackPath(): boolean {
    return this.preferredPath !== this.dbPath
  }

  async store(input: VectorRecordInput): Promise<void> {
    const normalized = input.content.replace(/\s+/g, ' ').trim().slice(0, this.maxContentLength)
    if (!normalized) {
      return
    }

    const vector = await this.embed(normalized)
    const table = await this.getTable(vector.length)
    const row: VectorRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      source: input.source,
      scope: input.scope,
      content: normalized,
      metadata: JSON.stringify(input.metadata ?? {}),
      vector,
      createdAt: new Date().toISOString(),
    }

    await table.add([row as unknown as Record<string, unknown>])
    this.writeCount += 1

    if (this.writeCount % 100 === 0) {
      void table.optimize().catch(() => undefined)
    }
  }

  async searchSimilar(query: string, limit = 5): Promise<VectorMatch[]> {
    const normalized = query.replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return []
    }

    const vector = await this.embed(normalized)
    const table = await this.getExistingTable()
    if (!table) {
      return []
    }

    const rows = await table.query().nearestTo(vector).limit(limit).toArray()
    return rows.map((row: any) => ({
      source: String(row.source),
      scope: String(row.scope),
      content: String(row.content),
      metadata: this.parseMetadata(row.metadata),
    }))
  }

  async count(): Promise<number> {
    const table = await this.getExistingTable()
    if (!table) {
      return 0
    }

    const count = await table.countRows()
    return Math.max(0, count - 1)
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connectionPromise) {
      this.connectionPromise = connect(this.dbPath)
    }
    return this.connectionPromise
  }

  private async getExistingTable(): Promise<Table | null> {
    if (this.tablePromise) {
      return this.tablePromise
    }

    const connection = await this.getConnection()
    const tableNames = await connection.tableNames()
    if (!tableNames.includes(this.tableName)) {
      return null
    }

    this.tablePromise = connection.openTable(this.tableName)
    return this.tablePromise
  }

  private async getTable(vectorSize: number): Promise<Table> {
    if (!this.tablePromise) {
      this.tablePromise = this.initializeTable(vectorSize)
    }
    return this.tablePromise
  }

  private async initializeTable(vectorSize: number): Promise<Table> {
    const connection = await this.getConnection()
    const tableNames = await connection.tableNames()
    if (tableNames.includes(this.tableName)) {
      return connection.openTable(this.tableName)
    }

    return connection.createTable(this.tableName, [
      {
        id: 'bootstrap',
        source: 'system',
        scope: 'memory',
        content: 'bootstrap record',
        metadata: '{}',
        vector: new Array(vectorSize).fill(0),
        createdAt: new Date().toISOString(),
      },
    ])
  }

  private parseMetadata(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') {
      return {}
    }
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
}
