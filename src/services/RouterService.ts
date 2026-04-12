import { GeminiProvider } from '../providers/geminiProvider'
import { LocalProvider } from '../providers/localProvider'
import type { ApexResponse } from '../providers/apexResponse'
import { config } from '@apex/core'
import type { Message } from '@apex/types'
import dns from 'node:dns/promises'
import { runtimeSettings } from '../runtime/runtimeSettings'
import { EventEmitter } from 'node:events'
import { DEFAULT_GEMINI_CLOUD_MODEL_ID } from '../models/geminiCloudModel'
import { USER_FACING_LOCAL_MODEL_TIMEOUT } from '../runtime/fetchWithTimeout'
import { emitDebugLog } from '../runtime/debugIngest'

function mergeCorrelation(payload: any, correlationId?: string) {
  if (!correlationId) return payload
  return {
    ...payload,
    correlationId,
    data:
      payload?.data != null && typeof payload.data === 'object'
        ? { ...payload.data, correlationId }
        : payload.data,
  }
}

function debugLog(payload: any, correlationId?: string) {
  const merged = mergeCorrelation(payload, correlationId)
  emitDebugLog(merged as Record<string, unknown>)
}

function correlationFromContext(context: any): string | undefined {
  const c = context?.metadata?.correlationId
  return typeof c === 'string' ? c : undefined
}

export type RouterMode = 'always_gemini' | 'always_local' | 'smart'

export type RouterDecision = {
  provider: 'gemini' | 'local'
  reason: string
  offline: boolean
  promptClass: 'simple' | 'heavy'
}

export type RouterServiceOptions = {
  offlineCheckTimeoutMs?: number
  simplePromptMaxChars?: number
  heavyPromptMinChars?: number
  geminiSlowThresholdMs?: number
  geminiSlowConsecutive?: number
}

type LatencyState = {
  consecutiveSlow: number
  lastMs: number | null
  emaMs: number | null
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isLikelySimplePrompt(prompt: string, maxChars: number): boolean {
  const p = prompt.trim()
  if (!p) return true
  if (p.length > maxChars) return false
  // “Simple” is short + looks like a quick fact/command.
  return (
    /^(what time is it\??|time\??|date\??|help\??|hi|hello|ping|status)\b/i.test(p) ||
    (!/[.?!]\s+\w+/.test(p) &&
      !/(analyze|design|refactor|debug|explain|compare|trade-?offs|step by step|reason)/i.test(p))
  )
}

function isLikelyHeavyPrompt(prompt: string, minChars: number, messages?: Message[]): boolean {
  const p = prompt.trim()
  const historyChars = (messages ?? []).reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
  if (p.length >= minChars) return true
  if (historyChars >= minChars * 2) return true
  return /(analyze|design|architecture|refactor|debug|root cause|prove|derive|long context|complex|step by step|plan)/i.test(
    p,
  )
}

async function isOnline(timeoutMs: number): Promise<boolean> {
  const timeout = clamp(timeoutMs, 200, 10_000)
  try {
    await Promise.race([
      dns.resolve('example.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('offline-timeout')), timeout)),
    ])
    return true
  } catch {
    return false
  }
}

export class RouterService {
  readonly events = new EventEmitter()
  private gemini = new GeminiProvider()
  private local = new LocalProvider()
  private latency: LatencyState = { consecutiveSlow: 0, lastMs: null, emaMs: null }
  private options: Required<RouterServiceOptions>

  constructor(options: RouterServiceOptions = {}) {
    this.options = {
      offlineCheckTimeoutMs: options.offlineCheckTimeoutMs ?? 1200,
      simplePromptMaxChars: options.simplePromptMaxChars ?? 60,
      heavyPromptMinChars: options.heavyPromptMinChars ?? 700,
      geminiSlowThresholdMs: options.geminiSlowThresholdMs ?? 7000,
      geminiSlowConsecutive: options.geminiSlowConsecutive ?? 2,
    }
  }

  getGeminiLatencySnapshot() {
    return { ...this.latency }
  }

  shouldOfferSwitchToLocal(): { offer: boolean; reason?: string } {
    if (this.latency.consecutiveSlow >= this.options.geminiSlowConsecutive) {
      return {
        offer: true,
        reason: `Gemini latency looks high (EMA≈${Math.round(this.latency.emaMs ?? 0)}ms).`,
      }
    }
    return { offer: false }
  }

  async decide(prompt: string, context: any): Promise<RouterDecision> {
    const mode =
      runtimeSettings.get().routerMode ?? ((config as any).routerMode as RouterMode | undefined) ?? 'smart'

    if (mode === 'always_gemini') {
      return { provider: 'gemini', reason: 'routerMode=always_gemini', offline: false, promptClass: 'heavy' }
    }
    if (mode === 'always_local') {
      return { provider: 'local', reason: 'routerMode=always_local', offline: false, promptClass: 'simple' }
    }

    const offline = !(await isOnline(this.options.offlineCheckTimeoutMs))
    if (offline) {
      return { provider: 'local', reason: 'offline detected', offline: true, promptClass: 'simple' }
    }

    const messages = context?.messages as Message[] | undefined
    if (isLikelySimplePrompt(prompt, this.options.simplePromptMaxChars)) {
      return { provider: 'local', reason: 'simple prompt heuristic', offline: false, promptClass: 'simple' }
    }
    if (isLikelyHeavyPrompt(prompt, this.options.heavyPromptMinChars, messages)) {
      return {
        provider: 'gemini',
        reason: 'heavy prompt/long context heuristic',
        offline: false,
        promptClass: 'heavy',
      }
    }

    // Default in smart mode: local first to save quota.
    return { provider: 'local', reason: 'smart default', offline: false, promptClass: 'simple' }
  }

  async query(
    prompt: string,
    context: any,
  ): Promise<
    ApexResponse & {
      router?: { decision: RouterDecision; switchToLocalOffer?: { offer: boolean; reason?: string } }
    }
  > {
    const cid = correlationFromContext(context)
    const decision = await this.decide(prompt, context)
    debugLog(
      {
        sessionId: '35112d',
        runId: 'gemini-check',
        hypothesisId: 'R1',
        location: 'src/services/RouterService.ts:query',
        message: 'Router decision (query)',
        data: {
          provider: decision.provider,
          reason: decision.reason,
          offline: decision.offline,
          promptClass: decision.promptClass,
          promptLen: String(prompt || '').length,
        },
        timestamp: Date.now(),
      },
      cid,
    )

    if (decision.provider === 'gemini') {
      const start = Date.now()
      const response = await this.gemini.generateResponse(prompt, context)
      const elapsed = Date.now() - start

      // Update latency EMA + slow streak.
      this.latency.lastMs = elapsed
      this.latency.emaMs =
        this.latency.emaMs == null ? elapsed : Math.round(this.latency.emaMs * 0.8 + elapsed * 0.2)
      this.latency.consecutiveSlow =
        elapsed >= this.options.geminiSlowThresholdMs ? this.latency.consecutiveSlow + 1 : 0

      return {
        ...response,
        router: {
          decision,
          switchToLocalOffer: this.shouldOfferSwitchToLocal(),
        },
      }
    }

    const response = await this.tryLocalThenGemini(prompt, context, decision)
    return { ...response, router: { decision } }
  }

  private isSensitivePrompt(prompt: string, context: any): boolean {
    if (context?.metadata?.sensitive === true) return true
    const p = (prompt ?? '').toLowerCase()
    // Keyword heuristic (keep conservative; can be refined).
    return /(password|passcode|2fa|otp|token|api key|secret key|ssh|private key|seed phrase|mnemonic|credit card|ssn|social security|bank account)/i.test(
      p,
    )
  }

  private isGeminiFallbackError(error: any): boolean {
    const msg = String(error?.message ?? error ?? '').toLowerCase()
    // Typical cases: offline/network, 429 rate limit, timeouts.
    return (
      msg.includes('429') ||
      msg.includes('rate') ||
      msg.includes('quota') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('fetch failed')
    )
  }

  private geminiKeyConfigured(): boolean {
    return Boolean(config.apiKeys.gemini?.trim())
  }

  /** True when local (Ollama) failed in a way that suggests switching to cloud is appropriate. */
  private isLocalInferenceUnavailableError(error: any): boolean {
    const msg = String(error?.message ?? error ?? '')
    if (msg === USER_FACING_LOCAL_MODEL_TIMEOUT) return true
    const lower = msg.toLowerCase()
    return (
      lower.includes('circuit breaker') ||
      lower.includes('ollama') ||
      lower.includes('local inference') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('fetch failed') ||
      lower.includes('failed to fetch') ||
      lower.includes('socket hang up') ||
      lower.includes('network') ||
      lower.includes('timeout') ||
      lower.includes('aborted')
    )
  }

  /** Never cloud-fallback when the request is treated as sensitive/local-only. */
  private canFallbackLocalToGemini(prompt: string, context: any): boolean {
    if (context?.metadata?.sensitive === true) return false
    const privacyMode = runtimeSettings.get().privacyMode ?? (config as any).privacyMode ?? false
    if (privacyMode && this.isSensitivePrompt(prompt, context)) return false
    return true
  }

  private async tryLocalThenGemini(
    prompt: string,
    context: any,
    decision: RouterDecision,
  ): Promise<ApexResponse> {
    try {
      return await this.local.generateResponse(prompt, context)
    } catch (error: any) {
      if (
        !this.canFallbackLocalToGemini(prompt, context) ||
        !this.geminiKeyConfigured() ||
        !this.isLocalInferenceUnavailableError(error) ||
        !(await isOnline(this.options.offlineCheckTimeoutMs))
      ) {
        throw error
      }
      const reason = error?.message ?? String(error)
      this.events.emit('fallback', {
        from: 'local',
        to: 'gemini',
        reason,
        at: new Date().toISOString(),
      })
      const response = await this.gemini.generateResponse(prompt, {
        ...context,
        tier: decision.promptClass === 'heavy' ? 'reasoning' : 'fast',
        model: DEFAULT_GEMINI_CLOUD_MODEL_ID,
      })
      return {
        ...response,
        text: `[⚠️ Ollama unavailable — using Gemini] ${response.text ?? ''}`.trim(),
      }
    }
  }

  /**
   * Gemini-first router for Talk Mode.
   *
   * Rules:
   * - If privacyMode + sensitive => force Local (never send to Gemini).
   * - If config.provider/config.current_provider === 'gemini' => try Gemini first.
   * - If Gemini fails (offline/network/429) => retry Local and emit a fallback event.
   */
  async queryBrain(prompt: string, context: any = {}): Promise<ApexResponse> {
    const cid = correlationFromContext(context)
    const forced = context?.executionProvider as 'gemini' | 'local' | undefined
    if (forced === 'gemini') {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'R2',
          location: 'src/services/RouterService.ts:queryBrain',
          message: 'Forced provider=gemini',
          data: { promptLen: String(prompt || '').length },
          timestamp: Date.now(),
        },
        cid,
      )
      try {
        return await this.gemini.generateResponse(prompt, context)
      } catch (error: any) {
        if (!this.isGeminiFallbackError(error)) {
          throw error
        }
        this.events.emit('fallback', {
          from: 'gemini',
          to: 'local',
          reason: error?.message ?? String(error),
          at: new Date().toISOString(),
        })
        const fastLocalModel = config.models.tiers.fast || config.models.chat
        const localResponse = await this.local.generateResponse(prompt, {
          ...context,
          model: fastLocalModel,
        })
        return {
          ...localResponse,
          text: `[⚠️ Network fallback to Local] ${localResponse.text ?? ''}`.trim(),
        }
      }
    }
    if (forced === 'local') {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'R3',
          location: 'src/services/RouterService.ts:queryBrain',
          message: 'Forced provider=local',
          data: { promptLen: String(prompt || '').length },
          timestamp: Date.now(),
        },
        cid,
      )
      const messages = context?.messages as Message[] | undefined
      const promptClass = isLikelyHeavyPrompt(prompt, this.options.heavyPromptMinChars, messages)
        ? 'heavy'
        : 'simple'
      return await this.tryLocalThenGemini(prompt, context, {
        provider: 'local',
        reason: 'forced_local',
        offline: false,
        promptClass,
      })
    }

    const providerPref =
      runtimeSettings.get().activeBrain ?? (config as any).provider ?? config.current_provider
    const wantsGemini = providerPref === 'gemini'
    debugLog(
      {
        sessionId: '35112d',
        runId: 'gemini-check',
        hypothesisId: 'R4',
        location: 'src/services/RouterService.ts:queryBrain',
        message: 'Router provider preference',
        data: {
          providerPref: String(providerPref),
          wantsGemini: Boolean(wantsGemini),
          privacyMode: Boolean(runtimeSettings.get().privacyMode ?? (config as any).privacyMode ?? false),
          promptLen: String(prompt || '').length,
        },
        timestamp: Date.now(),
      },
      cid,
    )
    const privacyMode = runtimeSettings.get().privacyMode ?? (config as any).privacyMode ?? false
    const sensitive = privacyMode && this.isSensitivePrompt(prompt, context)

    if (sensitive) {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'R5',
          location: 'src/services/RouterService.ts:queryBrain',
          message: 'Sensitive prompt forced local',
          data: {},
          timestamp: Date.now(),
        },
        cid,
      )
      const response = await this.local.generateResponse(prompt, context)
      return response
    }

    if (!wantsGemini) {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'R6',
          location: 'src/services/RouterService.ts:queryBrain',
          message: 'Prefers local => local',
          data: { providerPref: String(providerPref) },
          timestamp: Date.now(),
        },
        cid,
      )
      const messages = context?.messages as Message[] | undefined
      const promptClass = isLikelyHeavyPrompt(prompt, this.options.heavyPromptMinChars, messages)
        ? 'heavy'
        : 'simple'
      return await this.tryLocalThenGemini(prompt, context, {
        provider: 'local',
        reason: 'active_brain_local',
        offline: false,
        promptClass,
      })
    }

    try {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'R7',
          location: 'src/services/RouterService.ts:queryBrain',
          message: 'Attempting Gemini (queryBrain)',
          data: {},
          timestamp: Date.now(),
        },
        cid,
      )
      return await this.gemini.generateResponse(prompt, context)
    } catch (error: any) {
      if (!this.isGeminiFallbackError(error)) {
        throw error
      }

      const reason = error?.message ?? String(error)
      this.events.emit('fallback', {
        from: 'gemini',
        to: 'local',
        reason,
        at: new Date().toISOString(),
      })

      const fastLocalModel = config.models.tiers.fast || config.models.chat
      const localResponse = await this.local.generateResponse(prompt, {
        ...context,
        model: fastLocalModel,
      })
      return {
        ...localResponse,
        text: `[⚠️ Network fallback to Local] ${localResponse.text ?? ''}`.trim(),
      }
    }
  }
}

export const routerService = new RouterService()
