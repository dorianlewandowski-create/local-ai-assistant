import fs from 'fs';
import path from 'path';
import { connect, Connection, Table } from '@lancedb/lancedb';
import { config } from '../config';
import { ollamaEmbeddingProvider } from '../models/ollama';
import { embedWithFallback } from '../models/runtime';

export interface VectorRecordInput {
  source: string;
  scope: 'file' | 'chat' | 'memory' | 'gateway';
  content: string;
  metadata?: Record<string, unknown>;
}

interface VectorRow {
  id: string;
  source: string;
  scope: string;
  content: string;
  metadata: string;
  vector: number[];
  createdAt: string;
}

const DEFAULT_DB_PATH = config.storage.vectorStorePath;
const FALLBACK_DB_PATH = path.join(process.cwd(), 'data', 'lancedb');
const VECTOR_TABLE_NAME = 'knowledge_chunks';
const EMBEDDING_MODEL = config.models.embedding;
const FALLBACK_EMBEDDING_MODEL = config.models.embeddingFallback;
const MAX_CONTENT_LENGTH = 12000;

function resolveDbPath(preferredPath: string): string {
  try {
    fs.mkdirSync(preferredPath, { recursive: true });
    fs.accessSync(preferredPath, fs.constants.R_OK | fs.constants.W_OK);
    return preferredPath;
  } catch {
    if (preferredPath === FALLBACK_DB_PATH) {
      throw new Error(`Vector store path is not writable: ${preferredPath}`);
    }

    fs.mkdirSync(FALLBACK_DB_PATH, { recursive: true });
    fs.accessSync(FALLBACK_DB_PATH, fs.constants.R_OK | fs.constants.W_OK);
    console.warn(`Vector store path '${preferredPath}' is not writable. Falling back to '${FALLBACK_DB_PATH}'.`);
    return FALLBACK_DB_PATH;
  }
}

function preferredUsesFallback(preferredPath: string, resolvedPath: string): boolean {
  return preferredPath !== resolvedPath;
}

export class VectorStore {
  private connectionPromise: Promise<Connection> | null = null;
  private tablePromise: Promise<Table> | null = null;
  private writeCount = 0;
  private readonly dbPath: string;
  private readonly preferredPath: string;

  constructor(dbPath = DEFAULT_DB_PATH) {
    this.preferredPath = dbPath;
    this.dbPath = resolveDbPath(dbPath);
  }

  getPath(): string {
    return this.dbPath;
  }

  isUsingFallbackPath(): boolean {
    return preferredUsesFallback(this.preferredPath, this.dbPath);
  }

  async store(input: VectorRecordInput): Promise<void> {
    const normalized = input.content.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_LENGTH);
    if (!normalized) {
      return;
    }

    const vector = await this.embed(normalized);
    const table = await this.getTable(vector.length);
    const row: VectorRow = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      source: input.source,
      scope: input.scope,
      content: normalized,
      metadata: JSON.stringify(input.metadata ?? {}),
      vector,
      createdAt: new Date().toISOString(),
    };

    await table.add([row as unknown as Record<string, unknown>]);
    this.writeCount += 1;

    if (this.writeCount % 100 === 0) {
      void table.optimize().catch(() => undefined);
    }
  }

  async searchSimilar(query: string, limit = 5): Promise<Array<{ source: string; scope: string; content: string; metadata: Record<string, unknown> }>> {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return [];
    }

    const vector = await this.embed(normalized);
    const table = await this.getExistingTable();
    if (!table) {
      return [];
    }

    const rows = await table.query().nearestTo(vector).limit(limit).toArray();
    return rows.map((row: any) => ({
      source: String(row.source),
      scope: String(row.scope),
      content: String(row.content),
      metadata: this.parseMetadata(row.metadata),
    }));
  }

  async count(): Promise<number> {
    const table = await this.getExistingTable();
    if (!table) {
      return 0;
    }

    const count = await table.countRows();
    return Math.max(0, count - 1);
  }

  private async embed(input: string): Promise<number[]> {
    return embedWithFallback(ollamaEmbeddingProvider, EMBEDDING_MODEL, input, FALLBACK_EMBEDDING_MODEL);
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connectionPromise) {
      this.connectionPromise = connect(this.dbPath);
    }

    return this.connectionPromise;
  }

  private async getExistingTable(): Promise<Table | null> {
    if (this.tablePromise) {
      return this.tablePromise;
    }

    const connection = await this.getConnection();
    const tableNames = await connection.tableNames();
    if (!tableNames.includes(VECTOR_TABLE_NAME)) {
      return null;
    }

    this.tablePromise = connection.openTable(VECTOR_TABLE_NAME);
    return this.tablePromise;
  }

  private async getTable(vectorSize: number): Promise<Table> {
    if (!this.tablePromise) {
      this.tablePromise = this.initializeTable(vectorSize);
    }

    return this.tablePromise;
  }

  private async initializeTable(vectorSize: number): Promise<Table> {
    const connection = await this.getConnection();
    const tableNames = await connection.tableNames();
    if (tableNames.includes(VECTOR_TABLE_NAME)) {
      return connection.openTable(VECTOR_TABLE_NAME);
    }

    return connection.createTable(VECTOR_TABLE_NAME, [{
      id: 'bootstrap',
      source: 'system',
      scope: 'memory',
      content: 'bootstrap record',
      metadata: '{}',
      vector: new Array(vectorSize).fill(0),
      createdAt: new Date().toISOString(),
    }]);
  }

  private parseMetadata(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
}

export const vectorStore = new VectorStore();
