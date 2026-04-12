import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Phase 3 (docs/IMPLEMENTATION_PLAN_AGENTS_TOOLS.txt): catch accidental loss of
 * tool registration (missing imports in builtinTools, broken modules).
 *
 * How to update:
 *   • If you intentionally remove a tool from the codebase, remove its name
 *     from CRITICAL_TOOL_NAMES and adjust MIN_TOTAL_TOOLS if the count changes.
 *   • If you add many tools at once, raise MIN_TOTAL_TOOLS to match
 *     `npm run docs:list-tools` (core + skills counts) after `builtinTools` loads.
 *   • SDK worker plugins (e.g. ScreenControl.*) are not loaded under the default
 *     Node test runner; this test only covers the builtin pack + bundled skills.
 */

// Side effect: registers all tools imported by src/plugins/builtinTools.ts
import '../src/plugins/builtinTools'
import { toolRegistry } from '../src/tools/registry'

/** Representative native + skill ids; must exist after builtin pack loads. */
const CRITICAL_TOOL_NAMES = [
  'web_search',
  'fs_mv',
  'spawn_helper_agent',
  'file_organize_preview',
  'get_today_schedule',
  'checkpoint_start',
  'data_analysis_consult',
  'web_search_plus',
  'get_garmin_stats',
  'generate_tech_news_digest',
  'productivity_capture',
  'create_new_skill',
] as const

/** Floor for total registered tools (builtin + skills). See npm run docs:list-tools. */
const MIN_TOTAL_TOOLS = 80

test('builtin tool pack exposes critical tool names', () => {
  for (const name of CRITICAL_TOOL_NAMES) {
    const t = toolRegistry.getTool(name)
    assert.ok(t, `expected tool registry to include ${name}`)
  }
})

test('builtin tool pack size is within expected floor', () => {
  const n = toolRegistry.getAllTools().length
  assert.ok(
    n >= MIN_TOTAL_TOOLS,
    `expected at least ${MIN_TOTAL_TOOLS} tools after builtin pack load, got ${n}. ` +
      `If you added tools intentionally, raise MIN_TOTAL_TOOLS (see npm run docs:list-tools).`,
  )
})
