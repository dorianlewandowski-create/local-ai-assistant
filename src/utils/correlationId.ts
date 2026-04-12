import crypto from 'node:crypto'

/** Short id for tracing CLI → daemon → provider (e.g. req-a1b2c3d4e5f6). */
export function newCorrelationId(): string {
  return `req-${crypto.randomBytes(6).toString('hex')}`
}
