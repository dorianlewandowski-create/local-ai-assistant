import { config } from '@apex/core'

type AnyRecord = Record<string, any>

const HIGH_SIGNAL_ROLES = new Set([
  'AXButton',
  'AXStaticText',
  'AXTextField',
  'AXMenuItem',
  'AXLink',
  'AXCheckBox',
  'AXImage',
  // Electron/Chromium escape hatch: these can represent the whole app surface.
  'AXWebArea',
  'AXDocument',
])

const LAYOUT_CONTAINER_ROLES = new Set([
  'AXGroup',
  'AXUnknown',
  'AXLayoutArea',
  'AXScrollArea',
  'AXSplitGroup',
])

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function readRole(node: AnyRecord): string {
  // Prefer the native bridge stable-id schema (role) but tolerate variants.
  return (
    asString(node.role) || asString(node.AXRole) || asString(node.axRole) || asString(node?.attributes?.role)
  )
}

function readActions(node: AnyRecord): string[] {
  const candidates = [
    node.actions,
    node.AXActions,
    node.actionNames,
    node.AXActionNames,
    node.action,
    node.AXAction,
  ]

  for (const c of candidates) {
    if (Array.isArray(c)) return c.map(asString).filter(Boolean)
    if (typeof c === 'string' && c.trim()) return [c.trim()]
  }
  return []
}

function hasExplicitAction(node: AnyRecord): boolean {
  const actions = readActions(node)
  if (actions.length > 0) return true
  // Some bridges include booleans like "pressable"/"clickable".
  return Boolean(node.pressable || node.clickable || node.canPress || node.canClick)
}

function readTextSignal(node: AnyRecord): { title: string; description: string; value: string } {
  const title = asString(node.title || node.AXTitle || node.axTitle || node?.attributes?.title)
  const description = asString(
    node.description || node.AXDescription || node.axDescription || node?.attributes?.description,
  )
  const value = asString(node.value || node.AXValue || node.axValue || node?.attributes?.value)
  return { title, description, value }
}

function isHidden(node: AnyRecord): boolean {
  const v = node.isHidden ?? node.hidden ?? node.AXHidden ?? node.axHidden ?? node?.attributes?.hidden
  return v === true || v === 1 || v === 'true'
}

function readFrame(node: AnyRecord): { w: number; h: number } | null {
  const frame = node.frame ?? node.bounds ?? node.boundingBox ?? node.rect ?? node.AXFrame
  if (!frame || typeof frame !== 'object') return null
  const rec = frame as AnyRecord
  const w = rec.w ?? rec.width ?? rec.W ?? rec.Width
  const h = rec.h ?? rec.height ?? rec.H ?? rec.Height
  if (typeof w === 'number' && typeof h === 'number') return { w, h }
  return null
}

function hasZeroArea(node: AnyRecord): boolean {
  const frame = readFrame(node)
  if (!frame) return false
  return frame.w === 0 || frame.h === 0
}

function childrenOf(node: AnyRecord): any[] {
  const kids = node.children ?? node.AXChildren ?? node.axChildren ?? node?.attributes?.children
  return Array.isArray(kids) ? kids : []
}

function mergeUp(wrapper: AnyRecord, onlyChild: AnyRecord): AnyRecord {
  // Child wins for most fields; preserve wrapper id only if child lacks one.
  const merged: AnyRecord = { ...wrapper, ...onlyChild }
  if (wrapper.id && !onlyChild.id) merged.id = wrapper.id
  if (wrapper.role && !onlyChild.role) merged.role = wrapper.role
  if (wrapper.type && !onlyChild.type) merged.type = wrapper.type
  merged.children = onlyChild.children
  return merged
}

const DEBUG_PRUNER = config.performance.debugPruner

function tombstone(node: AnyRecord, reason: string): AnyRecord {
  return {
    _dropped: true,
    role: readRole(node) || node.role,
    reason,
  }
}

/**
 * Recursively prune and structurally compress a raw macOS Accessibility JSON tree.
 *
 * - Drops hidden/zero-area nodes
 * - Drops low-signal layout containers when they carry no text/value signal and no actionable descendants
 * - Keeps high-signal roles and any node with explicit actions
 * - Flattens single-child layout wrappers by merging properties upward
 */
export function pruneUiTree(node: any): any | null {
  if (!node || typeof node !== 'object') return null
  const record = node as AnyRecord

  const drop = (reason: string) => (DEBUG_PRUNER ? tombstone(record, reason) : null)

  if (isHidden(record)) return drop('Hidden')
  if (hasZeroArea(record)) return drop('Zero-area bounding box')

  const prunedChildren: any[] = []
  const children = childrenOf(record)
  for (let i = 0; i < children.length; i++) {
    const child = pruneUiTree(children[i])
    if (child) prunedChildren.push(child)
  }

  const role = readRole(record)
  const { title, description, value } = readTextSignal(record)
  const keepForRole = role ? HIGH_SIGNAL_ROLES.has(role) : false
  const keepForAction = hasExplicitAction(record)
  const hasTextSignal = Boolean(
    title.trim() || description.trim() || value.trim() || asString(record.label).trim(),
  )
  const hasActionableChild = prunedChildren.length > 0

  const isLayoutContainer = role ? LAYOUT_CONTAINER_ROLES.has(role) : false

  // Text-content override (safety net): if a node carries real string signal,
  // never drop it solely because its role looks like a layout container.
  // (We still prune its children above.)
  const keepForTextOverride = hasTextSignal

  // Drop low-signal containers when they contribute nothing themselves.
  if (isLayoutContainer && !keepForRole && !keepForAction && !keepForTextOverride && !hasActionableChild) {
    return drop('Low-signal layout container (no text/value, no actions, no kept children)')
  }

  const next: AnyRecord = { ...record, children: prunedChildren }

  // Flatten: if a layout-ish wrapper has exactly one child, merge to reduce depth.
  if (isLayoutContainer && next.children.length === 1) {
    const onlyChild = next.children[0]
    if (onlyChild && typeof onlyChild === 'object') {
      return mergeUp(next, onlyChild as AnyRecord)
    }
  }

  // If a node isn't high-signal and has no children and no signal/action, drop it.
  if (!keepForRole && !keepForAction && !keepForTextOverride && next.children.length === 0) {
    return drop('Leaf node with no text/value and no actions')
  }

  return next
}
