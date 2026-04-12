type CircuitState = 'closed' | 'open' | 'half_open'

export type CircuitSnapshot = {
  state: CircuitState
  openedUntilMs: number | null
  recentFailures: number
  lastFailureAtMs: number | null
}

/**
 * Simple in-process circuit breaker for local Ollama calls.
 *
 * Goals:
 * - Avoid tight-loop hammering when Ollama hangs or is overloaded
 * - Fail fast with a clear error message so the UI stays responsive
 */
function readPositiveInt(env: string | undefined, fallback: number): number {
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export class OllamaCircuitBreaker {
  private state: CircuitState = 'closed'
  private openedUntilMs: number | null = null
  private lastFailureAtMs: number | null = null
  private failureTimestampsMs: number[] = []
  private halfOpenInFlight = false

  constructor(
    private readonly opts: {
      failWindowMs: number
      failuresToOpen: number
      openDurationMs: number
    } = {
      failWindowMs: readPositiveInt(process.env.APEX_OLLAMA_CB_WINDOW_MS, 30_000),
      failuresToOpen: readPositiveInt(process.env.APEX_OLLAMA_CB_FAILURES, 3),
      openDurationMs: readPositiveInt(process.env.APEX_OLLAMA_CB_OPEN_MS, 60_000),
    },
  ) {}

  snapshot(): CircuitSnapshot {
    this.prune()
    return {
      state: this.state,
      openedUntilMs: this.openedUntilMs,
      recentFailures: this.failureTimestampsMs.length,
      lastFailureAtMs: this.lastFailureAtMs,
    }
  }

  preflight(): void {
    const now = Date.now()
    if (this.state === 'open') {
      if (this.openedUntilMs != null && now >= this.openedUntilMs) {
        this.state = 'half_open'
        this.openedUntilMs = null
      } else {
        throw new Error('Local inference is temporarily paused (Ollama circuit breaker open).')
      }
    }

    if (this.state === 'half_open') {
      if (this.halfOpenInFlight) {
        throw new Error('Local inference is temporarily paused (Ollama recovery probe in-flight).')
      }
      this.halfOpenInFlight = true
    }
  }

  recordSuccess(): void {
    this.halfOpenInFlight = false
    this.state = 'closed'
    this.openedUntilMs = null
    this.failureTimestampsMs = []
    this.lastFailureAtMs = null
  }

  recordFailure(): void {
    const now = Date.now()
    this.halfOpenInFlight = false
    this.lastFailureAtMs = now
    this.failureTimestampsMs.push(now)
    this.prune()

    if (this.failureTimestampsMs.length >= this.opts.failuresToOpen) {
      this.state = 'open'
      this.openedUntilMs = now + this.opts.openDurationMs
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.opts.failWindowMs
    while (this.failureTimestampsMs.length > 0 && this.failureTimestampsMs[0] < cutoff) {
      this.failureTimestampsMs.shift()
    }
  }
}

export const ollamaCircuitBreaker = new OllamaCircuitBreaker()
