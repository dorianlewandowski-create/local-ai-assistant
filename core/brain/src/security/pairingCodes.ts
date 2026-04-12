import crypto from 'node:crypto'

/**
 * Human-typed pairing code: 8 uppercase hex chars (~32 bits entropy).
 * Prefer this over Math.random() for channel pairing and gateway flows.
 */
export function generatePairingCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase()
}

export function pairingCodesEqual(stored: string, provided: string): boolean {
  const a = Buffer.from(String(stored).trim().toUpperCase(), 'utf8')
  const b = Buffer.from(String(provided).trim().toUpperCase(), 'utf8')
  if (a.length !== b.length) {
    return false
  }
  return crypto.timingSafeEqual(a, b)
}
