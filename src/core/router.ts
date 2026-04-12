import { config } from '@apex/core'
import type { ApexConfig } from '@apex/core'
import type { ModelTier } from '../models/modelRouter'

/** Minimal config pick for router + dashboard (mirrors `ApexConfig` fields). */
export type RouterRuntimeConfig = {
  modelMode: 'auto' | 'manual'
  lockedModel: string
}

/** Defaults when `apex.json` / env tiers are unset (must stay in sync with @apex/core defaults). */
const DEFAULT_FAST = 'gemma4:e2b-it-q8_0'
const DEFAULT_VISION = 'gemma4:e4b-it-q4_K_M'
const DEFAULT_ULTRA = 'gemini-3.1-pro-preview'

/**
 * Tier labels for routing / dashboard — always mirrors `config.models.tiers` used by `getRoute`.
 */
export function getModelProfiles(): { FAST: string; VISION: string; ULTRA: string } {
  const t = config.models.tiers
  return {
    FAST: t.fast || DEFAULT_FAST,
    VISION: t.vision || DEFAULT_VISION,
    ULTRA: t.reasoning || DEFAULT_ULTRA,
  }
}

/** @deprecated Use `getModelProfiles()` — values are dynamic from config. */
export const MODEL_PROFILES = new Proxy({} as { FAST: string; VISION: string; ULTRA: string }, {
  get(_, prop: string) {
    const p = getModelProfiles()
    if (prop === 'FAST') return p.FAST
    if (prop === 'VISION') return p.VISION
    if (prop === 'ULTRA') return p.ULTRA
    return undefined
  },
})

export type ModelProfileKey = 'FAST' | 'VISION' | 'ULTRA'

export type PromptRouteKind = 'fast' | 'vision' | 'reasoning'

/** Keyword / length heuristics for Auto-Mode. */
export function classifyPromptRoute(prompt: string): PromptRouteKind {
  const s = prompt.trim().toLowerCase()
  if (
    /\b(screen|click|ui|window|screenshot|display|viewport)\b/i.test(prompt) ||
    /\b(screens?|gui|interface)\b/i.test(s)
  ) {
    return 'vision'
  }
  if (
    prompt.length > 500 ||
    /\b(code|coding|complex|plan|planning|refactor|architecture|design)\b/i.test(prompt)
  ) {
    return 'reasoning'
  }
  return 'fast'
}

/** Resolves the model identifier string for logs / dashboard (manual: locked; auto: profile target). */
export function routePrompt(prompt: string, cfg: RouterRuntimeConfig): string {
  const profiles = getModelProfiles()
  if (cfg.modelMode === 'manual') {
    return cfg.lockedModel.trim() || profiles.FAST
  }
  const kind = classifyPromptRoute(prompt)
  if (kind === 'vision') return profiles.VISION
  if (kind === 'reasoning') return profiles.ULTRA
  return profiles.FAST
}

/** Merge agent-derived tier with prompt routing when Auto-Mode is on. */
export function resolveExecutionTier(
  prompt: string,
  agentTier: ModelTier,
  cfg: RouterRuntimeConfig,
): ModelTier {
  if (cfg.modelMode === 'manual') {
    return agentTier
  }
  // Do not force 'vision' just because the agent bundle exposes vision tools — that routed every
  // System-agent turn to the multimodal tier. Vision must come from the prompt (see classifyPromptRoute).
  if (agentTier === 'coding' || agentTier === 'reasoning') {
    return agentTier
  }
  const kind = classifyPromptRoute(prompt)
  if (kind === 'vision') {
    return 'vision'
  }
  if (kind === 'reasoning') {
    return 'reasoning'
  }
  return 'fast'
}

let lastPathKind: 'fast' | 'thought' = 'fast'

export function getPathKindForPrompt(
  prompt: string,
  cfg: Pick<RouterRuntimeConfig, 'modelMode' | 'lockedModel'>,
): 'fast' | 'thought' {
  if (cfg.modelMode === 'manual') {
    const lm = (cfg.lockedModel || '').toLowerCase()
    return lm === 'gemini' || lm.includes('gemini') ? 'thought' : 'fast'
  }
  const kind = classifyPromptRoute(prompt)
  return kind === 'fast' ? 'fast' : 'thought'
}

export function recordRouterStatusForPrompt(
  prompt: string,
  cfg: Pick<RouterRuntimeConfig, 'modelMode' | 'lockedModel'>,
): void {
  lastPathKind = getPathKindForPrompt(prompt, cfg)
}

export function getRouterStatusMode(activeTasks: number): string {
  const base = lastPathKind === 'fast' ? 'FAST-PATH' : 'THOUGHT-PATH'
  return activeTasks > 0 ? `${base} ○` : `${base} ⚡`
}

/** Short label for dashboard, e.g. gemma4:e2b-it-q8_0 → gemma4:e2b */
export function formatModelShort(modelId: string): string {
  const [family, tag] = modelId.split(':')
  if (!tag) {
    return modelId
  }
  const head = tag.split('-')[0] ?? tag
  return `${family}:${head}`
}

/** Tier labels from a specific loaded config (CLI dashboard / tests). */
export function getModelProfilesFromConfig(c: Pick<ApexConfig, 'models'>): {
  FAST: string
  VISION: string
  ULTRA: string
} {
  const t = c.models.tiers
  return {
    FAST: t.fast || DEFAULT_FAST,
    VISION: t.vision || DEFAULT_VISION,
    ULTRA: t.reasoning || DEFAULT_ULTRA,
  }
}

export function formatDashboardModelsLine(
  cfg: Pick<RouterRuntimeConfig, 'modelMode' | 'lockedModel'>,
): string {
  if (cfg.modelMode === 'manual') {
    const lock = (cfg.lockedModel || '').trim()
    const label =
      lock.toLowerCase() === 'gemini' || lock.toLowerCase().includes('gemini') ? 'Gemini' : lock || 'unknown'
    return `🔒 LOCKED (${label})`
  }
  const idle = formatModelShort(getModelProfiles().FAST)
  return `✨ AUTO (Current: ${idle})`
}

/** Model line from a fully merged `ApexConfig` (resolved env aliases, not raw `process.env`). */
export function formatDashboardModelsLineFromConfig(c: ApexConfig): string {
  if (c.modelMode === 'manual') {
    const lock = (c.lockedModel || '').trim()
    const label =
      lock.toLowerCase() === 'gemini' || lock.toLowerCase().includes('gemini') ? 'Gemini' : lock || 'unknown'
    return `🔒 LOCKED (${label})`
  }
  const idle = formatModelShort(getModelProfilesFromConfig(c).FAST)
  return `✨ AUTO (Current: ${idle})`
}

export function formatDashboardProviderLabel(c: Pick<ApexConfig, 'current_provider'>): string {
  return c.current_provider === 'gemini' ? 'Gemini' : 'Local'
}

export function formatDashboardPrivacyLabel(c: Pick<ApexConfig, 'privacyMode'>): string {
  return c.privacyMode ? 'On' : 'Off'
}
