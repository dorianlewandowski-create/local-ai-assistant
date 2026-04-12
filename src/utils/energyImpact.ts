import { logger } from './logger'

export type EnergyMetric =
  | 'screenshot'
  | 'vision_screenshot'
  | 'ax_ui_tree'
  | 'semantic_click'
  | 'mcp_tool_execution'
  | 'native_sandbox_run'
  | 'bytes_saved_by_delta'
  | 'plugin_ms'
  | 'plugin_execution'

interface MetricState {
  count: number
  windowStartMs: number
}

const WINDOW_MS = 60_000
const states = new Map<EnergyMetric, MetricState>()
let reporterStarted = false

function getState(metric: EnergyMetric): MetricState {
  const existing = states.get(metric)
  if (existing) {
    return existing
  }
  const created: MetricState = { count: 0, windowStartMs: Date.now() }
  states.set(metric, created)
  return created
}

function maybeStartReporter() {
  if (reporterStarted) {
    return
  }
  reporterStarted = true

  setInterval(() => {
    const now = Date.now()
    for (const [metric, state] of states.entries()) {
      const elapsed = Math.max(1, now - state.windowStartMs)
      const perMinute = Math.round((state.count * WINDOW_MS) / elapsed)
      const unit =
        metric === 'bytes_saved_by_delta'
          ? 'bytes/min'
          : metric === 'plugin_ms' || metric === 'plugin_execution'
            ? 'ms/min'
            : 'captures/min'
      logger.debug(`[EnergyImpact] ${metric} ${unit}=${perMinute}`)
      state.count = 0
      state.windowStartMs = now
    }
  }, WINDOW_MS).unref?.()
}

/**
 * Record an event that contributes to background "Energy Impact".
 *
 * The current implementation emits a single log line per minute per metric:
 * `"[EnergyImpact] <metric> captures/min=<N>"`
 *
 * When running as a LaunchAgent, these logs are visible in Console under the process stream.
 */
export function recordEnergyImpact(metric: EnergyMetric, amount = 1): void {
  maybeStartReporter()
  const state = getState(metric)
  state.count += amount
}
