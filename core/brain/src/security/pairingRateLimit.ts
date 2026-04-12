/** Rolling window for new pairing code minting (per channel + subject). */
const WINDOW_MS = 60 * 60 * 1000
const MAX_NEW_CODES_PER_WINDOW = 8

const buckets = new Map<string, number[]>()

export function pairingRateLimitKey(channel: string, subject: string): string {
  return `${channel}:${subject}`
}

/**
 * Records a **new** pairing code issuance. Returns false if the subject exceeded the window budget.
 * Call only when actually generating a new code (not when returning an existing pending code).
 */
export function recordNewPairingCode(key: string): boolean {
  const now = Date.now()
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= MAX_NEW_CODES_PER_WINDOW) {
    return false
  }
  arr.push(now)
  buckets.set(key, arr)
  return true
}

/** Test hook: clear in-memory counters (does not touch disk store). */
export function resetPairingRateLimitForTests(): void {
  buckets.clear()
}
