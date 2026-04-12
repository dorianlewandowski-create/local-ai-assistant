/**
 * Thrown when a caller requests too many **new** pairing codes for the same identity
 * within the rolling window (see pairingRateLimit.ts).
 */
export class PairingRateLimitedError extends Error {
  override readonly name = 'PairingRateLimitedError'

  constructor(message = 'Too many new pairing requests for this identity. Please try again later.') {
    super(message)
  }
}

export function isPairingRateLimitedError(err: unknown): err is PairingRateLimitedError {
  return err instanceof PairingRateLimitedError
}
