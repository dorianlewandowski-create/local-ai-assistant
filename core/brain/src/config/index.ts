// Apex core config module (source of truth for runtime configuration).
// Note: This file is intentionally self-contained to avoid any `src/*` imports from packages.
// Load `.env` via the app entrypoint (e.g. `src/loadEnv.ts`); do not call `dotenv.config()` here.

import fs from 'fs'
import os from 'os'
import path from 'path'
import fsp from 'fs/promises'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import {
  exitIfLegacyOpenmacEnvKeysPresent,
  readApexAliasedBoolean,
  readApexAliasedCsv,
  readApexAliasedNumber,
  readApexAliasedString,
} from './envAliasing'
import type { EnvSource } from './envAliasing'

// We intentionally keep this independent from the monolith logger. Core consumers can
// decide how to surface warnings.
function warn(message: string) {
  // eslint-disable-next-line no-console
  console.warn(message)
}

export const DEFAULT_CONFIG_FILE_NAME = 'apex.json'

interface RawConfig {
  current_provider?: 'gemini' | 'local'
  provider?: 'gemini' | 'local'
  /** Intelligent model router: auto = prompt-based tiering; manual = always `lockedModel`. */
  modelMode?: 'auto' | 'manual'
  lockedModel?: string
  routerMode?: 'always_gemini' | 'always_local' | 'smart'
  privacyMode?: boolean
  app?: {
    version?: string
    statusAiLabel?: string
  }
  models?: {
    chat?: string
    chatFallback?: string
    embedding?: string
    embeddingFallback?: string
    vision?: string
    transcription?: string
    webSearch?: string
    tiers?: {
      fast?: string
      reasoning?: string
      vision?: string
      coding?: string
    }
    /** ACP stream: `gemini` API vs `ollama` (env: `APEX_MODEL_PROVIDER`). */
    modelProvider?: string
    /** Gemini model id for ACP streaming (env: `GOOGLE_GEMINI_MODEL`). */
    geminiModel?: string
    /** Cloud fallback chain when Gemini returns 503/429 (env: `APEX_CLOUD_FALLBACK_CHAIN`). */
    cloudFallbackChain?: string[]
  }
  ollama?: {
    host?: string
  }
  watcher?: {
    directories?: string[]
    extensions?: string[]
  }
  scheduler?: {
    proactiveReviewIntervalMs?: number
    morningReviewHour?: number
    /** When true, enqueue a read-biased daily briefing task at `dailyDigestHour`. */
    dailyDigestEnabled?: boolean
    /** Hour (0–23, local time) for the daily digest. Defaults to `morningReviewHour` when unset. */
    dailyDigestHour?: number
    /** Post the digest text to Telegram (requires bot token + chat id). */
    dailyDigestTelegram?: boolean
  }
  storage?: {
    vectorStorePath?: string
    sessionStorePath?: string
  }
  sessions?: {
    maxPersistedSessions?: number
  }
  gateways?: {
    telegram?: {
      enabled?: boolean
      botToken?: string
      chatId?: string
    }
    slack?: {
      enabled?: boolean
      appToken?: string
      botToken?: string
      allowFrom?: string[]
    }
    whatsapp?: {
      enabled?: boolean
      executablePath?: string
      allowFrom?: string[]
      groupPolicy?: 'disabled' | 'allowlist' | 'open'
      groupAllowFrom?: string[]
    }
    discord?: {
      enabled?: boolean
      botToken?: string
      allowFrom?: string[]
    }
  }
  integrations?: {
    spotify?: {
      clientId?: string
      clientSecret?: string
    }
    jinaApiKey?: string
    wolframAppId?: string
    perplexityApiKey?: string
    tavilyApiKey?: string
    arxivMaxResults?: string
  }
  security?: {
    remoteSafeMode?: boolean
    remoteAllowedPermissions?: Array<'read' | 'write' | 'automation' | 'destructive'>
    authorizationTimeoutMs?: number
    pairingCodeTtlMs?: number
    channelToolAllowlists?: Partial<Record<'telegram' | 'slack' | 'whatsapp' | 'discord', string[]>>
    remoteSandboxMode?: boolean
    remoteSandboxAllowedPermissions?: Array<'read' | 'write' | 'automation' | 'destructive'>
  }
  media?: {
    maxTelegramFileBytes?: number
    maxVoiceNoteBytes?: number
  }
  plugins?: {
    enabled?: boolean
    directory?: string
    /** When true, load SDK-style plugins even under Node's `--test` (env: `APEX_SDK_PLUGINS=1`). */
    forceSdkPlugins?: boolean
  }
  runtimeService?: {
    enabled?: boolean
    port?: number
  }
  performance?: {
    visionMinCaptureIntervalMs?: number
    /** Debug logging for ScreenControl UI pruner (env: `APEX_DEBUG_PRUNER` / `DEBUG_PRUNER`). */
    debugPruner?: boolean
  }
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface ApexConfig {
  current_provider: 'gemini' | 'local'
  modelMode: 'auto' | 'manual'
  lockedModel: string
  routerMode: 'always_gemini' | 'always_local' | 'smart'
  privacyMode: boolean
  app: {
    version: string
    statusAiLabel: string
  }
  models: {
    chat: string
    chatFallback?: string
    embedding: string
    embeddingFallback?: string
    vision: string
    transcription?: string
    webSearch: string
    tiers: {
      fast: string
      reasoning: string
      vision: string
      coding: string
    }
    /** ACP stream provider for `ApexCoreOrchestrator` streaming path. */
    modelProvider: 'gemini' | 'ollama'
    /** Gemini model id when `modelProvider` is `gemini`. */
    geminiModel: string
    /** Cloud fallback chain when Gemini returns 503/429. */
    cloudFallbackChain: string[]
  }
  ollama: {
    host: string
  }
  watcher: {
    directories: string[]
    extensions: Set<string>
  }
  scheduler: {
    proactiveReviewIntervalMs: number
    morningReviewHour: number
    dailyDigestEnabled: boolean
    dailyDigestHour: number
    dailyDigestTelegram: boolean
  }
  storage: {
    vectorStorePath: string
    sessionStorePath: string
  }
  sessions: {
    maxPersistedSessions: number
  }
  gateways: {
    telegram: {
      enabled: boolean
      botToken?: string
      chatId?: string
    }
    slack: {
      enabled: boolean
      appToken?: string
      botToken?: string
      allowFrom: string[]
    }
    whatsapp: {
      enabled: boolean
      executablePath?: string
      allowFrom: string[]
      groupPolicy: 'disabled' | 'allowlist' | 'open'
      groupAllowFrom: string[]
    }
    discord: {
      enabled: boolean
      botToken?: string
      allowFrom: string[]
    }
  }
  apiKeys: {
    gemini?: string
    openai?: string
    anthropic?: string
  }
  integrations: {
    spotify: {
      clientId?: string
      clientSecret?: string
    }
    jinaApiKey?: string
    wolframAppId?: string
    perplexityApiKey?: string
    tavilyApiKey?: string
    arxivMaxResults: string
  }
  security: {
    remoteSafeMode: boolean
    remoteAllowedPermissions: Array<'read' | 'write' | 'automation' | 'destructive'>
    authorizationTimeoutMs: number
    pairingCodeTtlMs: number
    channelToolAllowlists: Partial<Record<'telegram' | 'slack' | 'whatsapp' | 'discord', string[]>>
    remoteSandboxMode: boolean
    remoteSandboxAllowedPermissions: Array<'read' | 'write' | 'automation' | 'destructive'>
  }
  media: {
    maxTelegramFileBytes: number
    maxVoiceNoteBytes: number
  }
  plugins: {
    enabled: boolean
    directory: string
    forceSdkPlugins: boolean
  }
  runtimeService: {
    enabled: boolean
    port: number
  }
  performance: {
    visionMinCaptureIntervalMs: number
    debugPruner: boolean
  }
  mcp: Record<string, McpServerConfig>
  meta: {
    configPath: string | null
  }
}

const McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
})

const McpConfigFileSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema),
})

const LegacyMcpArraySchema = z.array(
  z.object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  }),
)

/** Replace `{{ENV_VAR}}` with `process.env.ENV_VAR` (empty string if unset). */
function expandMcpEnvPlaceholder(value: string): string {
  return value.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (_, name: string) => process.env[name] ?? '')
}

function expandMcpServerConfig(cfg: McpServerConfig): McpServerConfig {
  return {
    command: expandMcpEnvPlaceholder(cfg.command),
    args: cfg.args?.map((a) => expandMcpEnvPlaceholder(a)),
    env: cfg.env
      ? Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, expandMcpEnvPlaceholder(v)]))
      : undefined,
  }
}

function expandMcpServersMap(servers: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(servers).map(([id, cfg]) => [id, expandMcpServerConfig(cfg)]))
}

export async function loadMcpConfig(cwd = process.cwd()): Promise<Record<string, McpServerConfig>> {
  const primaryPath = path.join(cwd, 'config', 'mcpServers.json')
  const examplePath = path.join(cwd, 'config', 'mcpServers.json.example')

  let chosenPath: string | null = null
  if (fs.existsSync(primaryPath)) {
    chosenPath = primaryPath
  } else if (fs.existsSync(examplePath)) {
    chosenPath = examplePath
    warn(
      `[MCP] config/mcpServers.json not found; using config/mcpServers.json.example (copy it to enable MCP servers).`,
    )
  } else {
    return {}
  }

  const raw = await fsp.readFile(chosenPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: any) {
    throw new Error(`[MCP] Failed to parse ${chosenPath}: ${error?.message ?? String(error)}`)
  }

  const modern = McpConfigFileSchema.safeParse(parsed)
  if (modern.success) {
    return expandMcpServersMap(modern.data.mcpServers)
  }

  const legacy = LegacyMcpArraySchema.safeParse(parsed)
  if (legacy.success) {
    const out: Record<string, McpServerConfig> = {}
    for (const item of legacy.data) {
      if (item.enabled === false) continue
      out[item.id] = expandMcpServerConfig({
        command: item.command,
        args: item.args,
        env: item.env,
      })
    }
    return out
  }

  throw new Error(`[MCP] Invalid MCP config format in ${chosenPath}`)
}

function readEnv(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function readBooleanEnv(env: EnvSource, name: string): boolean | undefined {
  const value = readEnv(env, name)
  if (!value) return undefined
  return value === '1' || value.toLowerCase() === 'true'
}

function readNumberEnv(env: EnvSource, name: string): number | undefined {
  const value = readEnv(env, name)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readCsvEnv(env: EnvSource, name: string): string[] | undefined {
  const value = readEnv(env, name)
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

function readKeychainGenericPasswordSync(options: { service: string; account: string }): string | undefined {
  try {
    const stdout = execFileSync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      options.service,
      '-a',
      options.account,
      '-w',
    ])
    const value = String(stdout ?? '').trim()
    return value ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Prefer `GOOGLE_GEMINI_API_KEY`; fall back to `GEMINI_API_KEY` for compatibility.
 * If env is unset, fall back to macOS Keychain item service="apex" account="gemini".
 */
function readGeminiApiKeyEnv(env: EnvSource): string | undefined {
  return (
    readEnv(env, 'GOOGLE_GEMINI_API_KEY') ??
    readEnv(env, 'GEMINI_API_KEY') ??
    readKeychainGenericPasswordSync({ service: 'apex', account: 'gemini' })
  )
}

function expandHomePath(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function normalizeStringArray(values: string[] | undefined, fallback: string[]): string[] {
  const items = (values ?? fallback).map((value) => expandHomePath(value.trim())).filter(Boolean)
  return items.length > 0 ? items : fallback
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override ?? base) as T
  }
  if (!base || typeof base !== 'object' || !override || typeof override !== 'object') {
    return (override ?? base) as T
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const existing = result[key]
    result[key] =
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      typeof value === 'object' &&
      !Array.isArray(value)
        ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value
  }
  return result as T
}

function loadConfigFile(configPath: string | null): RawConfig {
  if (!configPath) return {}
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as RawConfig
    return parsed
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      warn(
        `[Apex] Config file not found at ${configPath}. Using defaults and environment variables until the file exists.`,
      )
      return {}
    }
    throw e
  }
}

export function resolveConfigPath(cwd = process.cwd(), env: EnvSource = process.env): string | null {
  const explicitPath = readApexAliasedString(env, 'APEX_CONFIG')
  if (explicitPath) {
    return path.resolve(cwd, expandHomePath(explicitPath))
  }
  const defaultPath = path.join(cwd, DEFAULT_CONFIG_FILE_NAME)
  if (fs.existsSync(defaultPath)) return defaultPath
  return null
}

function buildEnvConfig(env: EnvSource): RawConfig {
  return {
    modelMode: readEnv(env, 'APEX_MODEL_MODE') as 'auto' | 'manual' | undefined,
    lockedModel: readEnv(env, 'APEX_LOCKED_MODEL'),
    current_provider: readApexAliasedString(env, 'APEX_CURRENT_PROVIDER') as 'gemini' | 'local' | undefined,
    provider: readApexAliasedString(env, 'APEX_PROVIDER') as 'gemini' | 'local' | undefined,
    routerMode: readApexAliasedString(env, 'APEX_ROUTER_MODE') as
      | 'always_gemini'
      | 'always_local'
      | 'smart'
      | undefined,
    privacyMode: readApexAliasedBoolean(env, 'APEX_PRIVACY_MODE'),
    models: {
      chat: readEnv(env, 'OLLAMA_MODEL'),
      chatFallback: readEnv(env, 'OLLAMA_FALLBACK_MODEL'),
      embedding: readEnv(env, 'OLLAMA_EMBEDDING_MODEL'),
      embeddingFallback: readEnv(env, 'OLLAMA_FALLBACK_EMBEDDING_MODEL'),
      vision: readEnv(env, 'OLLAMA_VISION_MODEL'),
      transcription: readEnv(env, 'OLLAMA_TRANSCRIPTION_MODEL'),
      webSearch: readEnv(env, 'PERPLEXITY_WEB_SEARCH_MODEL'),
      tiers: {
        fast: readApexAliasedString(env, 'APEX_MODEL_FAST'),
        reasoning: readApexAliasedString(env, 'APEX_MODEL_REASONING'),
        vision: readApexAliasedString(env, 'APEX_MODEL_VISION'),
        coding: readApexAliasedString(env, 'APEX_MODEL_CODING'),
      },
      modelProvider: readEnv(env, 'APEX_MODEL_PROVIDER'),
      geminiModel: readEnv(env, 'GOOGLE_GEMINI_MODEL'),
      cloudFallbackChain: readApexAliasedCsv(env, 'APEX_CLOUD_FALLBACK_CHAIN'),
    },
    ollama: {
      host: readEnv(env, 'OLLAMA_HOST'),
    },
    watcher: {
      directories: readApexAliasedCsv(env, 'APEX_WATCH_DIRECTORIES'),
      extensions: readApexAliasedCsv(env, 'APEX_WATCH_EXTENSIONS'),
    },
    scheduler: {
      proactiveReviewIntervalMs: readApexAliasedNumber(env, 'APEX_PROACTIVE_REVIEW_INTERVAL_MS'),
      morningReviewHour: readApexAliasedNumber(env, 'APEX_MORNING_REVIEW_HOUR'),
      dailyDigestEnabled: readApexAliasedBoolean(env, 'APEX_DAILY_DIGEST_ENABLED'),
      dailyDigestHour: readApexAliasedNumber(env, 'APEX_DAILY_DIGEST_HOUR'),
      dailyDigestTelegram: readApexAliasedBoolean(env, 'APEX_DAILY_DIGEST_TELEGRAM'),
    },
    storage: {
      vectorStorePath: readEnv(env, 'VECTOR_STORE_PATH'),
      sessionStorePath: readEnv(env, 'SESSION_STORE_PATH'),
    },
    sessions: {
      maxPersistedSessions: readApexAliasedNumber(env, 'APEX_MAX_PERSISTED_SESSIONS'),
    },
    gateways: {
      telegram: {
        enabled: readBooleanEnv(env, 'TELEGRAM_ENABLED'),
        botToken: readEnv(env, 'TELEGRAM_BOT_TOKEN'),
        chatId: readEnv(env, 'TELEGRAM_CHAT_ID'),
      },
      slack: {
        enabled: readBooleanEnv(env, 'SLACK_ENABLED'),
        appToken: readEnv(env, 'SLACK_APP_TOKEN'),
        botToken: readEnv(env, 'SLACK_BOT_TOKEN'),
        allowFrom: readApexAliasedCsv(env, 'APEX_SLACK_ALLOW_FROM'),
      },
      whatsapp: {
        enabled: readBooleanEnv(env, 'WHATSAPP_ENABLED'),
        executablePath: readEnv(env, 'PUPPETEER_EXECUTABLE_PATH'),
        allowFrom: readApexAliasedCsv(env, 'APEX_WHATSAPP_ALLOW_FROM'),
        groupPolicy: readApexAliasedString(env, 'APEX_WHATSAPP_GROUP_POLICY') as
          | 'disabled'
          | 'allowlist'
          | 'open'
          | undefined,
        groupAllowFrom: readApexAliasedCsv(env, 'APEX_WHATSAPP_GROUP_ALLOW_FROM'),
      },
      discord: {
        enabled: readBooleanEnv(env, 'DISCORD_ENABLED'),
        botToken: readEnv(env, 'DISCORD_BOT_TOKEN'),
        allowFrom: readApexAliasedCsv(env, 'APEX_DISCORD_ALLOW_FROM'),
      },
    },
    integrations: {
      spotify: {
        clientId: readEnv(env, 'SPOTIFY_CLIENT_ID'),
        clientSecret: readEnv(env, 'SPOTIFY_CLIENT_SECRET'),
      },
      jinaApiKey: readEnv(env, 'JINA_API_KEY'),
      wolframAppId: readEnv(env, 'WOLFRAM_API_ID'),
      perplexityApiKey: readEnv(env, 'PERPLEXITY_API_KEY'),
      tavilyApiKey: readEnv(env, 'TAVILY_API_KEY'),
      arxivMaxResults: readEnv(env, 'ARXIV_MAX_RESULTS'),
    },
    security: {
      remoteSafeMode: readApexAliasedBoolean(env, 'APEX_REMOTE_SAFE_MODE'),
      remoteAllowedPermissions: readApexAliasedCsv(env, 'APEX_REMOTE_ALLOWED_PERMISSIONS') as
        | Array<'read' | 'write' | 'automation' | 'destructive'>
        | undefined,
      authorizationTimeoutMs: readApexAliasedNumber(env, 'APEX_AUTHORIZATION_TIMEOUT_MS'),
      pairingCodeTtlMs: readApexAliasedNumber(env, 'APEX_PAIRING_CODE_TTL_MS'),
      channelToolAllowlists: {
        telegram: readApexAliasedCsv(env, 'APEX_TELEGRAM_ALLOWED_TOOLS'),
        slack: readApexAliasedCsv(env, 'APEX_SLACK_ALLOWED_TOOLS'),
        whatsapp: readApexAliasedCsv(env, 'APEX_WHATSAPP_ALLOWED_TOOLS'),
        discord: readApexAliasedCsv(env, 'APEX_DISCORD_ALLOWED_TOOLS'),
      },
      remoteSandboxMode: readApexAliasedBoolean(env, 'APEX_REMOTE_SANDBOX_MODE'),
      remoteSandboxAllowedPermissions: readApexAliasedCsv(env, 'APEX_REMOTE_SANDBOX_ALLOWED_PERMISSIONS') as
        | Array<'read' | 'write' | 'automation' | 'destructive'>
        | undefined,
    },
    media: {
      maxTelegramFileBytes: readApexAliasedNumber(env, 'APEX_MAX_TELEGRAM_FILE_BYTES'),
      maxVoiceNoteBytes: readApexAliasedNumber(env, 'APEX_MAX_VOICE_NOTE_BYTES'),
    },
    plugins: {
      enabled: readApexAliasedBoolean(env, 'APEX_PLUGINS_ENABLED'),
      directory: readApexAliasedString(env, 'APEX_PLUGINS_DIRECTORY'),
      forceSdkPlugins: readBooleanEnv(env, 'APEX_SDK_PLUGINS'),
    },
    runtimeService: {
      enabled: readApexAliasedBoolean(env, 'APEX_RUNTIME_SERVICE_ENABLED'),
      port: readApexAliasedNumber(env, 'APEX_RUNTIME_SERVICE_PORT'),
    },
    performance: {
      visionMinCaptureIntervalMs: readApexAliasedNumber(env, 'APEX_VISION_MIN_CAPTURE_INTERVAL_MS'),
      debugPruner: readBooleanEnv(env, 'APEX_DEBUG_PRUNER') ?? readBooleanEnv(env, 'DEBUG_PRUNER'),
    },
  }
}

const DEFAULT_WATCH_DIRECTORIES = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Downloads')]

const DEFAULT_WATCHED_EXTENSIONS = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png']

/** ACP streaming in `ApexCoreOrchestrator`: Gemini API vs local Ollama. */
function normalizeAcpStreamModelProvider(raw: string | undefined): 'gemini' | 'ollama' {
  const v = (raw ?? 'gemini').toLowerCase().trim()
  return v === 'ollama' ? 'ollama' : 'gemini'
}

function normalizeCurrentProvider(raw: unknown): 'gemini' | 'local' {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
  return v === 'gemini' ? 'gemini' : 'local'
}

function normalizeRouterMode(raw: unknown): 'always_gemini' | 'always_local' | 'smart' {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (v === 'always_gemini') return 'always_gemini'
  if (v === 'always_local') return 'always_local'
  return 'smart'
}

export function loadConfig(options: { cwd?: string; env?: EnvSource } = {}): ApexConfig {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  exitIfLegacyOpenmacEnvKeysPresent(env)
  const configPath = resolveConfigPath(cwd, env)

  const defaults: Required<RawConfig> = {
    current_provider: 'local',
    provider: 'local',
    modelMode: 'auto',
    lockedModel: '',
    routerMode: 'smart',
    privacyMode: false,
    app: {
      version: '1.0.0-rc.1',
      statusAiLabel: 'GEMMA-4',
    },
    models: {
      chat: 'gemma4:e4b',
      chatFallback: '',
      embedding: 'nomic-embed-text',
      embeddingFallback: '',
      vision: 'llama3.2-vision',
      transcription: '',
      webSearch: 'llama-3.1-sonar-small-128k-online',
      tiers: {
        fast: 'gemma4:e2b-it-q8_0',
        reasoning: 'gemini-3.1-pro-preview',
        vision: 'gemma4:e4b-it-q4_K_M',
        coding: 'gemini-3.1-pro-preview',
      },
      modelProvider: 'gemini',
      geminiModel: 'gemini-3.1-pro-preview',
      cloudFallbackChain: ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'],
    },
    ollama: {
      host: 'http://127.0.0.1:11434',
    },
    watcher: {
      directories: DEFAULT_WATCH_DIRECTORIES,
      extensions: DEFAULT_WATCHED_EXTENSIONS,
    },
    scheduler: {
      proactiveReviewIntervalMs: 4 * 60 * 60 * 1000,
      morningReviewHour: 8,
      dailyDigestEnabled: false,
      dailyDigestHour: 8,
      dailyDigestTelegram: false,
    },
    storage: {
      vectorStorePath: path.join(cwd, 'data', 'lancedb'),
      sessionStorePath: path.join(cwd, 'data', 'sessions.json'),
    },
    sessions: {
      maxPersistedSessions: 100,
    },
    gateways: {
      telegram: {
        enabled: false,
        botToken: '',
        chatId: '',
      },
      slack: {
        enabled: false,
        appToken: '',
        botToken: '',
        allowFrom: [],
      },
      whatsapp: {
        enabled: false,
        executablePath: '',
        allowFrom: [],
        groupPolicy: 'disabled',
        groupAllowFrom: [],
      },
      discord: {
        enabled: false,
        botToken: '',
        allowFrom: [],
      },
    },
    integrations: {
      spotify: {
        clientId: '',
        clientSecret: '',
      },
      jinaApiKey: '',
      wolframAppId: '',
      perplexityApiKey: '',
      tavilyApiKey: '',
      arxivMaxResults: '3',
    },
    security: {
      remoteSafeMode: true,
      remoteAllowedPermissions: ['read', 'write', 'automation'],
      authorizationTimeoutMs: 5 * 60 * 1000,
      pairingCodeTtlMs: 10 * 60 * 1000,
      channelToolAllowlists: {},
      remoteSandboxMode: true,
      remoteSandboxAllowedPermissions: ['read'],
    },
    media: {
      maxTelegramFileBytes: 10 * 1024 * 1024,
      maxVoiceNoteBytes: 10 * 1024 * 1024,
    },
    plugins: {
      enabled: true,
      directory: path.join(cwd, 'plugins'),
      forceSdkPlugins: false,
    },
    runtimeService: {
      enabled: true,
      port: 18787,
    },
    performance: {
      visionMinCaptureIntervalMs: 500,
      debugPruner: false,
    },
  }

  const fileConfig = loadConfigFile(configPath)
  const envConfig = buildEnvConfig(env)
  const merged = deepMerge(deepMerge(defaults, fileConfig), envConfig)

  const telegramConfig = { enabled: false, botToken: '', chatId: '', ...(merged.gateways?.telegram ?? {}) }
  const slackConfig = {
    enabled: false,
    appToken: '',
    botToken: '',
    allowFrom: [] as string[],
    ...(merged.gateways?.slack ?? {}),
  }
  const whatsappConfig = {
    enabled: false,
    executablePath: '',
    allowFrom: [] as string[],
    groupPolicy: 'disabled' as 'disabled' | 'allowlist' | 'open',
    groupAllowFrom: [] as string[],
    ...(merged.gateways?.whatsapp ?? {}),
  }
  const discordConfig = {
    enabled: false,
    botToken: '',
    allowFrom: [] as string[],
    ...(merged.gateways?.discord ?? {}),
  }

  const spotifyConfig = { clientId: '', clientSecret: '', ...(merged.integrations?.spotify ?? {}) }
  const securityConfig = {
    remoteSafeMode: true,
    remoteAllowedPermissions: ['read', 'write', 'automation'] as Array<
      'read' | 'write' | 'automation' | 'destructive'
    >,
    authorizationTimeoutMs: 5 * 60 * 1000,
    pairingCodeTtlMs: 10 * 60 * 1000,
    channelToolAllowlists: {},
    remoteSandboxMode: true,
    remoteSandboxAllowedPermissions: ['read'] as Array<'read' | 'write' | 'automation' | 'destructive'>,
    ...(merged.security ?? {}),
  }

  const mediaConfig = {
    maxTelegramFileBytes: 10 * 1024 * 1024,
    maxVoiceNoteBytes: 10 * 1024 * 1024,
    ...(merged.media ?? {}),
  }
  const pluginConfig = {
    enabled: true,
    directory: path.join(cwd, 'plugins'),
    forceSdkPlugins: false,
    ...(merged.plugins ?? {}),
  }
  const runtimeServiceConfig = { enabled: true, port: 18787, ...(merged.runtimeService ?? {}) }
  const performanceConfig = {
    visionMinCaptureIntervalMs: 500,
    debugPruner: false,
    ...(merged.performance ?? {}),
  }

  const vectorStorePath = merged.storage?.vectorStorePath ?? path.join(cwd, 'data', 'lancedb')
  const sessionStorePath = merged.storage?.sessionStorePath ?? path.join(cwd, 'data', 'sessions.json')

  return {
    current_provider: normalizeCurrentProvider(merged.current_provider ?? merged.provider),
    modelMode: merged.modelMode === 'manual' ? 'manual' : 'auto',
    lockedModel: merged.lockedModel ?? '',
    routerMode: normalizeRouterMode(merged.routerMode),
    privacyMode: merged.privacyMode ?? false,
    app: {
      version: merged.app?.version ?? '1.0.0-rc.1',
      statusAiLabel: merged.app?.statusAiLabel ?? 'GEMINI',
    },
    models: {
      chat: merged.models?.chat ?? 'gemma4:e4b',
      chatFallback: merged.models?.chatFallback || undefined,
      embedding: merged.models?.embedding ?? 'nomic-embed-text',
      embeddingFallback: merged.models?.embeddingFallback || undefined,
      vision: merged.models?.vision ?? 'qwen3-vl:4b',
      transcription: merged.models?.transcription || undefined,
      webSearch: merged.models?.webSearch ?? 'llama-3.1-sonar-small-128k-online',
      tiers: {
        fast: merged.models?.tiers?.fast ?? 'gemma4:e2b-it-q8_0',
        reasoning: merged.models?.tiers?.reasoning ?? 'gemini-3.1-pro-preview',
        vision: merged.models?.tiers?.vision ?? 'gemma4:e4b-it-q4_K_M',
        coding: merged.models?.tiers?.coding ?? 'gemini-3.1-pro-preview',
      },
      modelProvider: normalizeAcpStreamModelProvider(
        typeof merged.models?.modelProvider === 'string' ? merged.models.modelProvider : undefined,
      ),
      geminiModel:
        (merged.models?.geminiModel && merged.models.geminiModel.trim()) || 'gemini-3.1-pro-preview',
      cloudFallbackChain: (merged.models?.cloudFallbackChain ?? defaults.models.cloudFallbackChain ?? [])
        .map((m) => String(m ?? '').trim())
        .filter(Boolean),
    },
    ollama: {
      host: merged.ollama?.host ?? 'http://127.0.0.1:11434',
    },
    watcher: {
      directories: normalizeStringArray(merged.watcher?.directories, DEFAULT_WATCH_DIRECTORIES),
      extensions: new Set(
        normalizeStringArray(merged.watcher?.extensions, DEFAULT_WATCHED_EXTENSIONS).map((item) =>
          item.toLowerCase(),
        ),
      ),
    },
    scheduler: {
      proactiveReviewIntervalMs: merged.scheduler?.proactiveReviewIntervalMs ?? 4 * 60 * 60 * 1000,
      morningReviewHour: merged.scheduler?.morningReviewHour ?? 8,
      dailyDigestEnabled: merged.scheduler?.dailyDigestEnabled ?? false,
      dailyDigestHour: merged.scheduler?.dailyDigestHour ?? merged.scheduler?.morningReviewHour ?? 8,
      dailyDigestTelegram: merged.scheduler?.dailyDigestTelegram ?? false,
    },
    storage: {
      vectorStorePath: expandHomePath(vectorStorePath),
      sessionStorePath: expandHomePath(sessionStorePath),
    },
    sessions: {
      maxPersistedSessions: merged.sessions?.maxPersistedSessions ?? 100,
    },
    gateways: {
      telegram: {
        enabled: telegramConfig.enabled,
        botToken: telegramConfig.botToken || undefined,
        chatId: telegramConfig.chatId || undefined,
      },
      slack: {
        enabled: slackConfig.enabled,
        appToken: slackConfig.appToken || undefined,
        botToken: slackConfig.botToken || undefined,
        allowFrom: slackConfig.allowFrom,
      },
      whatsapp: {
        enabled: whatsappConfig.enabled,
        executablePath: whatsappConfig.executablePath
          ? expandHomePath(whatsappConfig.executablePath)
          : undefined,
        allowFrom: whatsappConfig.allowFrom,
        groupPolicy: whatsappConfig.groupPolicy,
        groupAllowFrom: whatsappConfig.groupAllowFrom,
      },
      discord: {
        enabled: discordConfig.enabled,
        botToken: discordConfig.botToken || undefined,
        allowFrom: discordConfig.allowFrom,
      },
    },
    apiKeys: {
      gemini: readGeminiApiKeyEnv(env),
      openai: readEnv(env, 'OPENAI_API_KEY'),
      anthropic: readEnv(env, 'ANTHROPIC_API_KEY'),
    },
    integrations: {
      spotify: {
        clientId: spotifyConfig.clientId || undefined,
        clientSecret: spotifyConfig.clientSecret || undefined,
      },
      jinaApiKey: merged.integrations?.jinaApiKey || undefined,
      wolframAppId: merged.integrations?.wolframAppId || undefined,
      perplexityApiKey: merged.integrations?.perplexityApiKey || undefined,
      tavilyApiKey: merged.integrations?.tavilyApiKey || undefined,
      arxivMaxResults: merged.integrations?.arxivMaxResults ?? '3',
    },
    security: {
      remoteSafeMode: securityConfig.remoteSafeMode,
      remoteAllowedPermissions: securityConfig.remoteAllowedPermissions,
      authorizationTimeoutMs: securityConfig.authorizationTimeoutMs,
      pairingCodeTtlMs: securityConfig.pairingCodeTtlMs,
      channelToolAllowlists: securityConfig.channelToolAllowlists,
      remoteSandboxMode: securityConfig.remoteSandboxMode,
      remoteSandboxAllowedPermissions: securityConfig.remoteSandboxAllowedPermissions,
    },
    media: {
      maxTelegramFileBytes: mediaConfig.maxTelegramFileBytes,
      maxVoiceNoteBytes: mediaConfig.maxVoiceNoteBytes,
    },
    plugins: {
      enabled: pluginConfig.enabled,
      directory: expandHomePath(pluginConfig.directory),
      forceSdkPlugins: Boolean(pluginConfig.forceSdkPlugins),
    },
    runtimeService: {
      enabled: runtimeServiceConfig.enabled,
      port: runtimeServiceConfig.port,
    },
    performance: {
      visionMinCaptureIntervalMs: performanceConfig.visionMinCaptureIntervalMs,
      debugPruner: Boolean(performanceConfig.debugPruner),
    },
    mcp: {},
    meta: {
      configPath,
    },
  }
}

export * from './envAliasing'

export const config: ApexConfig = loadConfig()
void loadMcpConfig().then(
  (mcp) => {
    config.mcp = mcp
  },
  (error) => {
    warn(`[MCP] Failed to load MCP config: ${error instanceof Error ? error.message : String(error)}`)
  },
)
