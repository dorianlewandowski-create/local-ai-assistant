import type {
  PermissionClass,
  Tool,
  ToolCategory,
  ToolManifest,
  ToolResult,
  ToolRiskLevel,
} from '@apex/types'
import { getToolManifest } from '../security/toolManifest'

const CATEGORY_BY_PREFIX: Array<[string, ToolCategory]> = [
  ['file_', 'filesystem'],
  ['fs_', 'filesystem'],
  ['calendar_', 'calendar'],
  ['browser_', 'browser'],
  ['web_', 'web'],
  ['search_', 'web'],
  ['read_', 'filesystem'],
  ['save_', 'memory'],
  ['recall_', 'memory'],
  ['execute_', 'automation'],
  ['open_', 'automation'],
  ['play_', 'automation'],
  ['set_', 'system'],
  ['toggle_', 'system'],
  ['send_', 'system'],
  ['take_', 'system'],
  ['get_', 'utility'],
]

const HIGH_RISK_TOOLS = new Set(['fs_rm', 'empty_trash', 'calendar_delete_event'])
const MEDIUM_RISK_TOOLS = new Set([
  'fs_write',
  'fs_patch',
  'fs_mv',
  'fs_cp',
  'fs_mkdir',
  'fs_organize',
  'calendar_create_event',
  'calendar_update_event',
  'execute_applescript',
  'open_app',
  'play_spotify_track',
  'play_spotify_search',
  'toggle_dark_mode',
  'set_system_volume',
  'hide_all_apps',
  'take_screenshot',
  'send_system_notification',
  'save_fact',
  'reminders_create_item',
  'reminders_complete_item',
  'reminders_delete_item',
])

export function inferToolCategory(toolName: string): ToolCategory {
  const matched = CATEGORY_BY_PREFIX.find(([prefix]) => toolName.startsWith(prefix))
  return matched?.[1] ?? 'utility'
}

export function inferToolRiskLevel(toolName: string): ToolRiskLevel {
  if (HIGH_RISK_TOOLS.has(toolName)) {
    return 'high'
  }

  if (
    MEDIUM_RISK_TOOLS.has(toolName) ||
    toolName.startsWith('execute_') ||
    toolName.startsWith('open_') ||
    toolName.startsWith('play_') ||
    toolName.startsWith('set_') ||
    toolName.startsWith('toggle_') ||
    toolName.startsWith('send_') ||
    toolName.startsWith('take_')
  ) {
    return 'medium'
  }

  return 'low'
}

export function inferToolPermissionClass(toolName: string): PermissionClass {
  if (HIGH_RISK_TOOLS.has(toolName)) {
    return 'destructive'
  }

  if (
    toolName.startsWith('execute_') ||
    toolName.startsWith('open_') ||
    toolName.startsWith('play_') ||
    toolName.startsWith('set_') ||
    toolName.startsWith('toggle_') ||
    toolName.startsWith('send_') ||
    toolName.startsWith('take_')
  ) {
    return 'automation'
  }

  if (
    MEDIUM_RISK_TOOLS.has(toolName) ||
    toolName.startsWith('fs_') ||
    toolName.startsWith('calendar_') ||
    toolName.startsWith('reminders_') ||
    toolName.startsWith('save_')
  ) {
    return 'write'
  }

  return 'read'
}

export function resolveToolManifest(tool: Tool): ToolManifest {
  const category = tool.category ?? inferToolCategory(tool.name)
  const riskLevel = tool.riskLevel ?? inferToolRiskLevel(tool.name)
  const permissionClass = inferToolPermissionClass(tool.name)
  return getToolManifest(tool, category, riskLevel, permissionClass)
}

export function normalizeToolResult(tool: Tool, result: unknown): ToolResult {
  const risk = tool.manifest?.riskLevel ?? tool.riskLevel ?? inferToolRiskLevel(tool.name)

  if (result && typeof result === 'object' && 'success' in result) {
    const typed = result as Record<string, unknown>
    const success = typed.success === true
    const error = typeof typed.error === 'string' ? typed.error : undefined
    const message =
      typeof typed.message === 'string'
        ? typed.message
        : typeof typed.result === 'string'
          ? typed.result
          : error || `${tool.name} ${success ? 'completed successfully.' : 'failed.'}`

    return {
      success,
      message,
      data: 'data' in typed ? typed.data : typed,
      error,
      risk,
      result: typeof typed.result === 'string' ? typed.result : message,
    }
  }

  const message = typeof result === 'string' ? result : JSON.stringify(result)
  return {
    success: true,
    message,
    data: result,
    risk,
    result: message,
  }
}
