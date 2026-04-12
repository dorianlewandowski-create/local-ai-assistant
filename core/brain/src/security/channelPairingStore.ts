import fs from 'node:fs'
import path from 'path'
import { readApexAliasedString } from '../config/envAliasing'
import { generatePairingCode, pairingCodesEqual } from './pairingCodes'
import { pairingRateLimitKey, recordNewPairingCode } from './pairingRateLimit'
import { PairingRateLimitedError } from './pairingErrors'

export type SupportedChannel = 'slack' | 'whatsapp' | 'discord'

interface PendingPairing {
  subject: string
  code: string
  expiresAt: number
}

interface ChannelStoreState {
  approved: Record<SupportedChannel, string[]>
  pending: Record<SupportedChannel, PendingPairing[]>
}

const DEFAULT_TTL_MS = 60 * 60 * 1000

function getStorePath(): string {
  return (
    readApexAliasedString(process.env, 'APEX_CHANNEL_PAIRING_STORE_PATH') ||
    path.join(process.cwd(), 'data', 'channel-pairings.json')
  )
}

function emptyState(): ChannelStoreState {
  return {
    approved: { slack: [], whatsapp: [], discord: [] },
    pending: { slack: [], whatsapp: [], discord: [] },
  }
}

function loadState(): ChannelStoreState {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ChannelStoreState>
    const base = emptyState()
    return {
      approved: {
        slack: parsed.approved?.slack?.map(String) ?? base.approved.slack,
        whatsapp: parsed.approved?.whatsapp?.map(String) ?? base.approved.whatsapp,
        discord: parsed.approved?.discord?.map(String) ?? base.approved.discord,
      },
      pending: {
        slack: (parsed.pending?.slack ?? []).map((entry) => ({
          subject: String((entry as any).subject),
          code: String((entry as any).code),
          expiresAt: Number((entry as any).expiresAt),
        })),
        whatsapp: (parsed.pending?.whatsapp ?? []).map((entry) => ({
          subject: String((entry as any).subject),
          code: String((entry as any).code),
          expiresAt: Number((entry as any).expiresAt),
        })),
        discord: (parsed.pending?.discord ?? []).map((entry) => ({
          subject: String((entry as any).subject),
          code: String((entry as any).code),
          expiresAt: Number((entry as any).expiresAt),
        })),
      },
    }
  } catch {
    return emptyState()
  }
}

function saveState(state: ChannelStoreState): void {
  const storePath = getStorePath()
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(storePath, 0o600)
  } catch {
    // ignore
  }
}

function pruneExpired(state: ChannelStoreState): void {
  const now = Date.now()
  for (const channel of ['slack', 'whatsapp', 'discord'] as const) {
    state.pending[channel] = state.pending[channel].filter((entry) => entry.expiresAt > now)
  }
}

function normalizeSubject(subject: string): string {
  return subject.trim()
}

export function isChannelSubjectApproved(
  channel: SupportedChannel,
  subject: string,
  configuredAllowlist: string[] = [],
): boolean {
  const normalized = normalizeSubject(subject)
  if (configuredAllowlist.includes(normalized)) {
    return true
  }

  const state = loadState()
  pruneExpired(state)
  return state.approved[channel].includes(normalized)
}

export function getOrCreatePairingCode(
  channel: SupportedChannel,
  subject: string,
): { code: string; isNew: boolean } {
  const normalized = normalizeSubject(subject)
  const state = loadState()
  pruneExpired(state)
  const existing = state.pending[channel].find((entry) => entry.subject === normalized)
  if (existing) {
    saveState(state)
    return { code: existing.code, isNew: false }
  }

  const rateKey = pairingRateLimitKey(channel, normalized)
  if (!recordNewPairingCode(rateKey)) {
    throw new PairingRateLimitedError()
  }

  const code = generatePairingCode()
  state.pending[channel].push({
    subject: normalized,
    code,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  })
  saveState(state)
  return { code, isNew: true }
}

export function approvePairingCode(channel: SupportedChannel, code: string): string | null {
  const normalizedCode = code.trim().toUpperCase()
  const state = loadState()
  pruneExpired(state)
  const entry = state.pending[channel].find((item) => pairingCodesEqual(item.code, normalizedCode))
  if (!entry) {
    return null
  }

  state.pending[channel] = state.pending[channel].filter((item) => item !== entry)
  if (!state.approved[channel].includes(entry.subject)) {
    state.approved[channel].push(entry.subject)
  }
  saveState(state)
  return entry.subject
}

export function listPendingPairings(
  channel: SupportedChannel,
): Array<{ subject: string; code: string; expiresAt: number }> {
  const state = loadState()
  pruneExpired(state)
  saveState(state)
  return state.pending[channel].map((entry) => ({ ...entry }))
}

export { PairingRateLimitedError } from './pairingErrors'
export { resetPairingRateLimitForTests } from './pairingRateLimit'
