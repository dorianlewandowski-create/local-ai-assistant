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

export interface EnergyImpactRecorder {
  recordEnergyImpact(metric: EnergyMetric, amount?: number): void
}
