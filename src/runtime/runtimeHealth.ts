import { config } from '@apex/core'
import { DOCTOR_HTTP_TIMEOUT_MS, fetchTextWithTimeout } from './fetchWithTimeout'

/** Unauthenticated probe: same contract as `apex doctor` /health check. */
export async function isRuntimeHealthOk(): Promise<boolean> {
  const baseUrl = `http://127.0.0.1:${config.runtimeService.port}`
  try {
    const r = await fetchTextWithTimeout(
      `${baseUrl}/health`,
      { method: 'GET' },
      { timeoutMs: DOCTOR_HTTP_TIMEOUT_MS },
    )
    return r.ok && r.text.trim() === 'ok'
  } catch {
    return false
  }
}
