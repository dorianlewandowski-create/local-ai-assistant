import fs from 'fs';
import path from 'path';

type SupportedChannel = 'slack' | 'whatsapp';

interface PendingPairing {
  subject: string;
  code: string;
  expiresAt: number;
}

interface ChannelStoreState {
  approved: Record<SupportedChannel, string[]>;
  pending: Record<SupportedChannel, PendingPairing[]>;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function getStorePath(): string {
  return process.env.OPENMAC_CHANNEL_PAIRING_STORE_PATH?.trim() || path.join(process.cwd(), 'data', 'channel-pairings.json');
}

function emptyState(): ChannelStoreState {
  return {
    approved: {
      slack: [],
      whatsapp: [],
    },
    pending: {
      slack: [],
      whatsapp: [],
    },
  };
}

function loadState(): ChannelStoreState {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChannelStoreState>;
    return {
      approved: {
        slack: parsed.approved?.slack?.map(String) ?? [],
        whatsapp: parsed.approved?.whatsapp?.map(String) ?? [],
      },
      pending: {
        slack: (parsed.pending?.slack ?? []).map((entry) => ({ subject: String(entry.subject), code: String(entry.code), expiresAt: Number(entry.expiresAt) })),
        whatsapp: (parsed.pending?.whatsapp ?? []).map((entry) => ({ subject: String(entry.subject), code: String(entry.code), expiresAt: Number(entry.expiresAt) })),
      },
    };
  } catch {
    return emptyState();
  }
}

function saveState(state: ChannelStoreState): void {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
}

function pruneExpired(state: ChannelStoreState): void {
  const now = Date.now();
  for (const channel of ['slack', 'whatsapp'] as const) {
    state.pending[channel] = state.pending[channel].filter((entry) => entry.expiresAt > now);
  }
}

function normalizeSubject(subject: string): string {
  return subject.trim();
}

export function isChannelSubjectApproved(channel: SupportedChannel, subject: string, configuredAllowlist: string[] = []): boolean {
  const normalized = normalizeSubject(subject);
  if (configuredAllowlist.includes(normalized)) {
    return true;
  }

  const state = loadState();
  pruneExpired(state);
  return state.approved[channel].includes(normalized);
}

export function getOrCreatePairingCode(channel: SupportedChannel, subject: string): { code: string; isNew: boolean } {
  const normalized = normalizeSubject(subject);
  const state = loadState();
  pruneExpired(state);
  const existing = state.pending[channel].find((entry) => entry.subject === normalized);
  if (existing) {
    saveState(state);
    return { code: existing.code, isNew: false };
  }

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  state.pending[channel].push({
    subject: normalized,
    code,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
  saveState(state);
  return { code, isNew: true };
}

export function approvePairingCode(channel: SupportedChannel, code: string): string | null {
  const normalizedCode = code.trim().toUpperCase();
  const state = loadState();
  pruneExpired(state);
  const entry = state.pending[channel].find((item) => item.code === normalizedCode);
  if (!entry) {
    return null;
  }

  state.pending[channel] = state.pending[channel].filter((item) => item.code !== normalizedCode);
  if (!state.approved[channel].includes(entry.subject)) {
    state.approved[channel].push(entry.subject);
  }
  saveState(state);
  return entry.subject;
}

export function listPendingPairings(channel: SupportedChannel): Array<{ subject: string; code: string; expiresAt: number }> {
  const state = loadState();
  pruneExpired(state);
  saveState(state);
  return state.pending[channel].map((entry) => ({ ...entry }));
}
