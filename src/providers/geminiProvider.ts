import { GoogleGenerativeAI } from '@google/generative-ai'
import { BaseProvider } from './baseProvider'
import { ApexResponse } from './apexResponse'
import { config } from '@apex/core'
import { readKeychainGenericPassword } from '../utils/keychain'
import type { ToolCall } from '@apex/types'
import { normalizeToolCalls } from './toolCallParser'
import { logger } from '../utils/logger'
import { activeModelState } from '../runtime/activeModelState'
import { DEFAULT_GEMINI_CLOUD_MODEL_ID } from '../models/geminiCloudModel'
import { emitDebugLog } from '../runtime/debugIngest'

function debugLog(payload: any) {
  emitDebugLog(payload as Record<string, unknown>)
}

type GeminiFunctionDeclaration = {
  name: string
  description?: string
  parameters?: unknown
}

function toGeminiFunctionDeclarations(tools: any[] | undefined): GeminiFunctionDeclaration[] {
  if (!tools) return []
  const out: GeminiFunctionDeclaration[] = []
  for (const tool of tools) {
    const fn = tool?.function
    if (!fn?.name) continue
    out.push({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
    })
  }
  return out
}

function toolCallsFromGeminiParts(parts: any[] | undefined): ToolCall[] {
  if (!Array.isArray(parts)) return []
  const calls: ToolCall[] = []
  for (const part of parts) {
    const fc = part?.functionCall
    if (!fc?.name) continue
    calls.push({
      id: `gemini_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: 'function',
      function: {
        name: String(fc.name),
        arguments: JSON.stringify(fc.args ?? {}),
      },
    })
  }
  return calls
}

async function resolveGeminiApiKey(): Promise<string> {
  const fromEnv = config.apiKeys.gemini?.trim()
  if (fromEnv) return fromEnv

  // Fallback: Keychain item (service/account conventions).
  const fromKeychain = await readKeychainGenericPassword({ service: 'apex', account: 'gemini' })
  if (fromKeychain) return fromKeychain

  throw new Error(
    'Gemini API key not configured. Set GOOGLE_GEMINI_API_KEY in .env or add Keychain item service="apex" account="gemini".',
  )
}

export class GeminiProvider extends BaseProvider {
  async generateResponse(prompt: string, context: any): Promise<ApexResponse> {
    const apiKey = await resolveGeminiApiKey()
    const requestedModel: string = String(context?.model ?? DEFAULT_GEMINI_CLOUD_MODEL_ID)

    const chainFromConfig = Array.isArray((config as any)?.models?.cloudFallbackChain)
      ? ((config as any).models.cloudFallbackChain as string[])
      : []
    const baseChain =
      chainFromConfig.length > 0
        ? chainFromConfig
        : [DEFAULT_GEMINI_CLOUD_MODEL_ID, 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro']

    const chain = [
      requestedModel,
      ...baseChain.filter((m) => String(m).trim() && String(m).trim() !== requestedModel),
    ]
    debugLog({
      sessionId: '35112d',
      runId: 'gemini-check',
      hypothesisId: 'G1',
      location: 'src/providers/geminiProvider.ts:generateResponse',
      message: 'Gemini request start',
      data: { requestedModel, chainLen: chain.length, promptLen: String(prompt || '').length },
      timestamp: Date.now(),
    })

    const isRetryableCloudError = (error: any): boolean => {
      const status = Number(error?.status ?? error?.response?.status ?? NaN)
      if (status === 503 || status === 429) return true
      const msg = String(error?.message ?? error ?? '').toLowerCase()
      return (
        msg.includes('503') ||
        msg.includes('service unavailable') ||
        msg.includes('429') ||
        msg.includes('too many')
      )
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const tools = context?.tools as any[] | undefined
    const functionDeclarations = toGeminiFunctionDeclarations(tools)

    const messages = Array.isArray(context?.messages) ? context.messages : []
    const systemFromMessages = messages
      .filter((m: any) => m?.role === 'system' && m?.content)
      .map((m: any) => String(m.content))
      .join('\n\n')
      .trim()
    const systemInstruction =
      String(context?.systemInstruction ?? systemFromMessages ?? '').trim() || undefined

    const safetySettings = context?.safetySettings as any[] | undefined

    const contents = [
      ...messages
        .filter((m: any) => m?.role !== 'system') // system handled via systemInstruction above
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content ?? '') }],
        })),
      ...(prompt
        ? [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ]
        : []),
    ]

    let lastError: any = null
    for (let i = 0; i < chain.length; i++) {
      const candidateModel = chain[i]
      try {
        debugLog({
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'G2',
          location: 'src/providers/geminiProvider.ts:generateResponse',
          message: 'Gemini attempting model',
          data: { i, model: candidateModel },
          timestamp: Date.now(),
        })
        const model = genAI.getGenerativeModel({
          model: candidateModel,
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(safetySettings ? { safetySettings } : {}),
          ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] as any } : {}),
        })

        // Prevent indefinite hangs: @google/generative-ai supports SingleRequestOptions.timeout (ms).
        const geminiTimeoutMs = Math.max(5_000, Number(process.env.APEX_GEMINI_TIMEOUT_MS || 120_000))
        const result = await model.generateContent({ contents } as any, {
          timeout: geminiTimeoutMs,
        })
        const response = result.response as any
        debugLog({
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'G3',
          location: 'src/providers/geminiProvider.ts:generateResponse',
          message: 'Gemini success',
          data: { i, model: candidateModel },
          timestamp: Date.now(),
        })

        // Update UI/live state with the actual successful model.
        activeModelState.set({
          provider: 'gemini',
          model: candidateModel,
          tier: String(context?.tier ?? 'cloud'),
          note: i > 0 ? `cloud_fallback_${i}` : undefined,
        })

        const text = (response?.text?.() ?? '').toString()
        const candidateParts = response?.candidates?.[0]?.content?.parts as any[] | undefined
        const toolCalls = normalizeToolCalls(toolCallsFromGeminiParts(candidateParts), text)
        return { text, toolCalls }
      } catch (error: any) {
        lastError = error
        debugLog({
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'G4',
          location: 'src/providers/geminiProvider.ts:generateResponse',
          message: 'Gemini model error',
          data: {
            i,
            model: candidateModel,
            status: Number(error?.status ?? error?.response?.status ?? -1),
            msg: String(error?.message ?? '').slice(0, 180),
          },
          timestamp: Date.now(),
        })
        if (isRetryableCloudError(error) && i < chain.length - 1) {
          logger.system(
            `[API] ${String(error?.status ?? error?.response?.status ?? '503')} High Demand/Rate Limit: Cascading to next cloud model...`,
          )
          continue
        }
        throw error
      }
    }

    throw lastError ?? new Error('Gemini cloud fallback chain exhausted.')
  }
}
