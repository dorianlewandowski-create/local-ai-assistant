import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_CONFIG_FILE_NAME = 'openmac.json';

type EnvSource = Record<string, string | undefined>;

interface RawConfig {
  app?: {
    version?: string;
    statusAiLabel?: string;
  };
  models?: {
    chat?: string;
    chatFallback?: string;
    embedding?: string;
    embeddingFallback?: string;
    vision?: string;
    transcription?: string;
    webSearch?: string;
    tiers?: {
      fast?: string;
      reasoning?: string;
      vision?: string;
      coding?: string;
    };
  };
  ollama?: {
    host?: string;
  };
  watcher?: {
    directories?: string[];
    extensions?: string[];
  };
  scheduler?: {
    proactiveReviewIntervalMs?: number;
    morningReviewHour?: number;
  };
  storage?: {
    vectorStorePath?: string;
    sessionStorePath?: string;
  };
  sessions?: {
    maxPersistedSessions?: number;
  };
  gateways?: {
    telegram?: {
      enabled?: boolean;
      botToken?: string;
      chatId?: string;
    };
    slack?: {
      enabled?: boolean;
      appToken?: string;
      botToken?: string;
      allowFrom?: string[];
    };
    whatsapp?: {
      enabled?: boolean;
      executablePath?: string;
      allowFrom?: string[];
      groupPolicy?: 'disabled' | 'allowlist' | 'open';
      groupAllowFrom?: string[];
    };
  };
  integrations?: {
    spotify?: {
      clientId?: string;
      clientSecret?: string;
    };
    jinaApiKey?: string;
    wolframAppId?: string;
    perplexityApiKey?: string;
    tavilyApiKey?: string;
    arxivMaxResults?: string;
  };
  security?: {
    remoteSafeMode?: boolean;
    remoteAllowedPermissions?: Array<'read' | 'write' | 'automation' | 'destructive'>;
    authorizationTimeoutMs?: number;
    pairingCodeTtlMs?: number;
    channelToolAllowlists?: Partial<Record<'telegram' | 'slack' | 'whatsapp', string[]>>;
    remoteSandboxMode?: boolean;
    remoteSandboxAllowedPermissions?: Array<'read' | 'write' | 'automation' | 'destructive'>;
  };
  dashboard?: {
    enabled?: boolean;
    port?: number;
  };
  media?: {
    maxTelegramFileBytes?: number;
    maxVoiceNoteBytes?: number;
  };
  plugins?: {
    enabled?: boolean;
    directory?: string;
  };
  runtimeService?: {
    enabled?: boolean;
    port?: number;
  };
}

export interface OpenMacConfig {
  app: {
    version: string;
    statusAiLabel: string;
  };
  models: {
    chat: string;
    chatFallback?: string;
    embedding: string;
    embeddingFallback?: string;
    vision: string;
    transcription?: string;
    webSearch: string;
    tiers: {
      fast: string;
      reasoning: string;
      vision: string;
      coding: string;
    };
  };
  ollama: {
    host: string;
  };
  watcher: {
    directories: string[];
    extensions: Set<string>;
  };
  scheduler: {
    proactiveReviewIntervalMs: number;
    morningReviewHour: number;
  };
  storage: {
    vectorStorePath: string;
    sessionStorePath: string;
  };
  sessions: {
    maxPersistedSessions: number;
  };
  gateways: {
    telegram: {
      enabled: boolean;
      botToken?: string;
      chatId?: string;
    };
    slack: {
      enabled: boolean;
      appToken?: string;
      botToken?: string;
      allowFrom: string[];
    };
    whatsapp: {
      enabled: boolean;
      executablePath?: string;
      allowFrom: string[];
      groupPolicy: 'disabled' | 'allowlist' | 'open';
      groupAllowFrom: string[];
    };
  };
  integrations: {
    spotify: {
      clientId?: string;
      clientSecret?: string;
    };
    jinaApiKey?: string;
    wolframAppId?: string;
    perplexityApiKey?: string;
    tavilyApiKey?: string;
    arxivMaxResults: string;
  };
  security: {
    remoteSafeMode: boolean;
    remoteAllowedPermissions: Array<'read' | 'write' | 'automation' | 'destructive'>;
    authorizationTimeoutMs: number;
    pairingCodeTtlMs: number;
    channelToolAllowlists: Partial<Record<'telegram' | 'slack' | 'whatsapp', string[]>>;
    remoteSandboxMode: boolean;
    remoteSandboxAllowedPermissions: Array<'read' | 'write' | 'automation' | 'destructive'>;
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
  media: {
    maxTelegramFileBytes: number;
    maxVoiceNoteBytes: number;
  };
  plugins: {
    enabled: boolean;
    directory: string;
  };
  runtimeService: {
    enabled: boolean;
    port: number;
  };
  meta: {
    configPath: string | null;
  };
}

function readEnv(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function readBooleanEnv(env: EnvSource, name: string): boolean | undefined {
  const value = readEnv(env, name);
  if (!value) {
    return undefined;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

function readNumberEnv(env: EnvSource, name: string): number | undefined {
  const value = readEnv(env, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readCsvEnv(env: EnvSource, name: string): string[] | undefined {
  const value = readEnv(env, name);
  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function normalizeStringArray(values: string[] | undefined, fallback: string[]): string[] {
  const items = (values ?? fallback)
    .map((value) => expandHomePath(value.trim()))
    .filter(Boolean);

  return items.length > 0 ? items : fallback;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override ?? base) as T;
  }

  if (!base || typeof base !== 'object' || !override || typeof override !== 'object') {
    return (override ?? base) as T;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];
    result[key] = existing && typeof existing === 'object' && !Array.isArray(existing) && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }

  return result as T;
}

function loadConfigFile(configPath: string | null): RawConfig {
  if (!configPath) {
    return {};
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as RawConfig;
  return parsed;
}

export function resolveConfigPath(cwd = process.cwd(), env: EnvSource = process.env): string | null {
  const explicitPath = readEnv(env, 'OPENMAC_CONFIG');
  if (explicitPath) {
    return path.resolve(cwd, expandHomePath(explicitPath));
  }

  const defaultPath = path.join(cwd, DEFAULT_CONFIG_FILE_NAME);
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function buildEnvConfig(env: EnvSource): RawConfig {
  return {
    models: {
      chat: readEnv(env, 'OLLAMA_MODEL'),
      chatFallback: readEnv(env, 'OLLAMA_FALLBACK_MODEL'),
      embedding: readEnv(env, 'OLLAMA_EMBEDDING_MODEL'),
      embeddingFallback: readEnv(env, 'OLLAMA_FALLBACK_EMBEDDING_MODEL'),
      vision: readEnv(env, 'OLLAMA_VISION_MODEL'),
      transcription: readEnv(env, 'OLLAMA_TRANSCRIPTION_MODEL'),
      webSearch: readEnv(env, 'PERPLEXITY_WEB_SEARCH_MODEL'),
      tiers: {
        fast: readEnv(env, 'OPENMAC_MODEL_FAST'),
        reasoning: readEnv(env, 'OPENMAC_MODEL_REASONING'),
        vision: readEnv(env, 'OPENMAC_MODEL_VISION'),
        coding: readEnv(env, 'OPENMAC_MODEL_CODING'),
      },
    },
    ollama: {
      host: readEnv(env, 'OLLAMA_HOST'),
    },
    watcher: {
      directories: readCsvEnv(env, 'OPENMAC_WATCH_DIRECTORIES'),
      extensions: readCsvEnv(env, 'OPENMAC_WATCH_EXTENSIONS'),
    },
    scheduler: {
      proactiveReviewIntervalMs: readNumberEnv(env, 'OPENMAC_PROACTIVE_REVIEW_INTERVAL_MS'),
      morningReviewHour: readNumberEnv(env, 'OPENMAC_MORNING_REVIEW_HOUR'),
    },
    storage: {
      vectorStorePath: readEnv(env, 'VECTOR_STORE_PATH'),
      sessionStorePath: readEnv(env, 'SESSION_STORE_PATH'),
    },
    sessions: {
      maxPersistedSessions: readNumberEnv(env, 'OPENMAC_MAX_PERSISTED_SESSIONS'),
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
        allowFrom: readCsvEnv(env, 'OPENMAC_SLACK_ALLOW_FROM'),
      },
      whatsapp: {
        enabled: readBooleanEnv(env, 'WHATSAPP_ENABLED'),
        executablePath: readEnv(env, 'PUPPETEER_EXECUTABLE_PATH'),
        allowFrom: readCsvEnv(env, 'OPENMAC_WHATSAPP_ALLOW_FROM'),
        groupPolicy: (readEnv(env, 'OPENMAC_WHATSAPP_GROUP_POLICY') as 'disabled' | 'allowlist' | 'open' | undefined),
        groupAllowFrom: readCsvEnv(env, 'OPENMAC_WHATSAPP_GROUP_ALLOW_FROM'),
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
      remoteSafeMode: readBooleanEnv(env, 'OPENMAC_REMOTE_SAFE_MODE'),
      remoteAllowedPermissions: readCsvEnv(env, 'OPENMAC_REMOTE_ALLOWED_PERMISSIONS') as Array<'read' | 'write' | 'automation' | 'destructive'> | undefined,
      authorizationTimeoutMs: readNumberEnv(env, 'OPENMAC_AUTHORIZATION_TIMEOUT_MS'),
      pairingCodeTtlMs: readNumberEnv(env, 'OPENMAC_PAIRING_CODE_TTL_MS'),
      channelToolAllowlists: {
        telegram: readCsvEnv(env, 'OPENMAC_TELEGRAM_ALLOWED_TOOLS'),
        slack: readCsvEnv(env, 'OPENMAC_SLACK_ALLOWED_TOOLS'),
        whatsapp: readCsvEnv(env, 'OPENMAC_WHATSAPP_ALLOWED_TOOLS'),
      },
      remoteSandboxMode: readBooleanEnv(env, 'OPENMAC_REMOTE_SANDBOX_MODE'),
      remoteSandboxAllowedPermissions: readCsvEnv(env, 'OPENMAC_REMOTE_SANDBOX_ALLOWED_PERMISSIONS') as Array<'read' | 'write' | 'automation' | 'destructive'> | undefined,
    },
    dashboard: {
      enabled: readBooleanEnv(env, 'OPENMAC_DASHBOARD_ENABLED'),
      port: readNumberEnv(env, 'OPENMAC_DASHBOARD_PORT'),
    },
    media: {
      maxTelegramFileBytes: readNumberEnv(env, 'OPENMAC_MAX_TELEGRAM_FILE_BYTES'),
      maxVoiceNoteBytes: readNumberEnv(env, 'OPENMAC_MAX_VOICE_NOTE_BYTES'),
    },
    plugins: {
      enabled: readBooleanEnv(env, 'OPENMAC_PLUGINS_ENABLED'),
      directory: readEnv(env, 'OPENMAC_PLUGINS_DIRECTORY'),
    },
    runtimeService: {
      enabled: readBooleanEnv(env, 'OPENMAC_RUNTIME_SERVICE_ENABLED'),
      port: readNumberEnv(env, 'OPENMAC_RUNTIME_SERVICE_PORT'),
    },
  };
}

const DEFAULT_WATCH_DIRECTORIES = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Downloads'),
];

const DEFAULT_WATCHED_EXTENSIONS = ['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png'];

export function loadConfig(options: { cwd?: string; env?: EnvSource } = {}): OpenMacConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = resolveConfigPath(cwd, env);

  const defaults: Required<RawConfig> = {
    app: {
      version: '0.7.4',
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
        fast: 'llama3.2:3b',
        reasoning: 'deepseek-r1:14b',
        vision: 'llama3.2-vision',
        coding: 'qwen2.5-coder:7b',
      },
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
    dashboard: {
      enabled: false,
      port: 18788,
    },
    media: {
      maxTelegramFileBytes: 10 * 1024 * 1024,
      maxVoiceNoteBytes: 10 * 1024 * 1024,
    },
    plugins: {
      enabled: true,
      directory: path.join(cwd, 'plugins'),
    },
    runtimeService: {
      enabled: true,
      port: 18787,
    },
  };

  const fileConfig = loadConfigFile(configPath);
  const envConfig = buildEnvConfig(env);
  const merged = deepMerge(deepMerge(defaults, fileConfig), envConfig);
  const telegramConfig = {
    enabled: false,
    botToken: '',
    chatId: '',
    ...(merged.gateways?.telegram ?? {}),
  };
  const slackConfig = {
    enabled: false,
    appToken: '',
    botToken: '',
    allowFrom: [] as string[],
    ...(merged.gateways?.slack ?? {}),
  };
  const whatsappConfig = {
    enabled: false,
    executablePath: '',
    allowFrom: [] as string[],
    groupPolicy: 'disabled' as 'disabled' | 'allowlist' | 'open',
    groupAllowFrom: [] as string[],
    ...(merged.gateways?.whatsapp ?? {}),
  };
  const spotifyConfig = {
    clientId: '',
    clientSecret: '',
    ...(merged.integrations?.spotify ?? {}),
  };
  const securityConfig = {
    remoteSafeMode: true,
    remoteAllowedPermissions: ['read', 'write', 'automation'] as Array<'read' | 'write' | 'automation' | 'destructive'>,
    authorizationTimeoutMs: 5 * 60 * 1000,
    pairingCodeTtlMs: 10 * 60 * 1000,
    channelToolAllowlists: {},
    remoteSandboxMode: true,
    remoteSandboxAllowedPermissions: ['read'] as Array<'read' | 'write' | 'automation' | 'destructive'>,
    ...(merged.security ?? {}),
  };
  const dashboardConfig = {
    enabled: false,
    port: 18788,
    ...(merged.dashboard ?? {}),
  };
  const mediaConfig = {
    maxTelegramFileBytes: 10 * 1024 * 1024,
    maxVoiceNoteBytes: 10 * 1024 * 1024,
    ...(merged.media ?? {}),
  };
  const pluginConfig = {
    enabled: true,
    directory: path.join(cwd, 'plugins'),
    ...(merged.plugins ?? {}),
  };
  const runtimeServiceConfig = {
    enabled: true,
    port: 18787,
    ...(merged.runtimeService ?? {}),
  };
  const vectorStorePath = merged.storage?.vectorStorePath ?? path.join(cwd, 'data', 'lancedb');
  const sessionStorePath = merged.storage?.sessionStorePath ?? path.join(cwd, 'data', 'sessions.json');

  return {
    app: {
      version: merged.app?.version ?? '0.7.4',
      statusAiLabel: merged.app?.statusAiLabel ?? 'GEMMA-4',
    },
    models: {
      chat: merged.models?.chat ?? 'gemma4:e4b',
      chatFallback: merged.models?.chatFallback || undefined,
      embedding: merged.models?.embedding ?? 'nomic-embed-text',
      embeddingFallback: merged.models?.embeddingFallback || undefined,
      vision: merged.models?.vision ?? 'llama3.2-vision',
      transcription: merged.models?.transcription || undefined,
      webSearch: merged.models?.webSearch ?? 'llama-3.1-sonar-small-128k-online',
      tiers: {
        fast: merged.models?.tiers?.fast ?? 'llama3.2:3b',
        reasoning: merged.models?.tiers?.reasoning ?? 'deepseek-r1:14b',
        vision: merged.models?.tiers?.vision ?? 'llama3.2-vision',
        coding: merged.models?.tiers?.coding ?? 'qwen2.5-coder:7b',
      },
    },
    ollama: {
      host: merged.ollama?.host ?? 'http://127.0.0.1:11434',
    },
    watcher: {
      directories: normalizeStringArray(merged.watcher.directories, DEFAULT_WATCH_DIRECTORIES),
      extensions: new Set(normalizeStringArray(merged.watcher.extensions, DEFAULT_WATCHED_EXTENSIONS).map((item) => item.toLowerCase())),
    },
    scheduler: {
      proactiveReviewIntervalMs: merged.scheduler?.proactiveReviewIntervalMs ?? 4 * 60 * 60 * 1000,
      morningReviewHour: merged.scheduler?.morningReviewHour ?? 8,
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
        executablePath: whatsappConfig.executablePath ? expandHomePath(whatsappConfig.executablePath) : undefined,
        allowFrom: whatsappConfig.allowFrom,
        groupPolicy: whatsappConfig.groupPolicy,
        groupAllowFrom: whatsappConfig.groupAllowFrom,
      },
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
    dashboard: {
      enabled: dashboardConfig.enabled,
      port: dashboardConfig.port,
    },
    media: {
      maxTelegramFileBytes: mediaConfig.maxTelegramFileBytes,
      maxVoiceNoteBytes: mediaConfig.maxVoiceNoteBytes,
    },
    plugins: {
      enabled: pluginConfig.enabled,
      directory: expandHomePath(pluginConfig.directory),
    },
    runtimeService: {
      enabled: runtimeServiceConfig.enabled,
      port: runtimeServiceConfig.port,
    },
    meta: {
      configPath,
    },
  };
}

export const config = loadConfig();
