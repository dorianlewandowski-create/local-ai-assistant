import type { PermissionClass, SubAgentKind } from '@apex/types'
import { toolRegistry } from '../tools/registry'
import { inferToolPermissionClass } from '../tools/result'

/**
 * Resolves permission class for policy: prefer registry manifest (see security/toolManifest),
 * then inference.
 */
export function resolvePermissionClassForPolicy(toolName: string): PermissionClass {
  const m = toolRegistry.getTool(toolName)?.manifest
  return m?.permissionClass ?? inferToolPermissionClass(toolName)
}

/**
 * Explicit write-capable tools allowed for Researcher (memory/soul/consult) beyond read-only.
 * Bundled skills that register as `write` must be listed here or use manifest category `memory`.
 */
const RESEARCHER_WRITE_ALLOWLIST = new Set<string>([
  'save_fact',
  'log_correction',
  'log_reflection',
  'update_soul',
  'data_analysis_consult',
])

/**
 * Filters the session/tool allowlist for a sub-agent kind.
 * - **coder** / **system**: full list (no sub-agent shrinking).
 * - **researcher**: read-only isolation — `read` tools, plus allowlisted `write` tools
 *   (memory/soul/consult) or any `write` tool whose manifest category is `memory`.
 *   Drops **automation** and **destructive** entirely.
 *
 * If filtering would remove everything, returns the original list (safe fallback).
 */
export function filterToolsForSubAgentKind(kind: SubAgentKind, allToolNames: string[]): string[] {
  if (kind === 'coder' || kind === 'system') {
    return allToolNames
  }
  if (kind !== 'researcher') {
    return allToolNames
  }

  const next: string[] = []
  for (const name of allToolNames) {
    const tool = toolRegistry.getTool(name)
    const m = tool?.manifest
    const pc = m?.permissionClass ?? inferToolPermissionClass(name)

    if (pc === 'destructive') {
      continue
    }
    if (pc === 'automation') {
      continue
    }
    if (pc === 'read') {
      next.push(name)
      continue
    }
    if (pc === 'write') {
      if (RESEARCHER_WRITE_ALLOWLIST.has(name)) {
        next.push(name)
        continue
      }
      if (m?.category === 'memory') {
        next.push(name)
        continue
      }
      continue
    }
  }

  return next.length > 0 ? next : allToolNames
}
