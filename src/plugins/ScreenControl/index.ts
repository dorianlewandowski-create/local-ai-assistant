import { z } from 'zod'
import type { Tool } from '@apex/types'
import type { OpenMacPlugin, PluginContext, SystemEvent } from '../../sdk/types'
import { recordEnergyImpact } from '../../utils/energyImpact'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { pruneUiTree } from './uiPruner'

const execFileAsync = promisify(execFile)

async function clickAt(x: number, y: number, signal?: AbortSignal): Promise<void> {
  await execFileAsync('osascript', ['-e', `tell application "System Events" to click at {${x}, ${y}}`], {
    windowsHide: true,
    signal: signal as any,
  })
}

type AxFrame = { x: number; y: number; w: number; h: number }
type AxNode = {
  id?: string
  label?: string
  frame?: AxFrame
  enabled?: boolean
  hidden?: boolean
  children?: AxNode[]
}

function isFrame(value: unknown): value is AxFrame {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    typeof record.w === 'number' &&
    typeof record.h === 'number'
  )
}

function isNode(value: unknown): value is AxNode {
  return Boolean(value && typeof value === 'object')
}

function walkNodes(root: unknown): AxNode[] {
  const out: AxNode[] = []
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!isNode(current)) continue
    const node = current as AxNode
    out.push(node)
    const children = Array.isArray(node.children) ? node.children : []
    for (let i = 0; i < children.length; i++) {
      stack.push(children[i])
    }
  }
  return out
}

function centerOf(frame: AxFrame): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function buildGetUiTreeTool(plugin: ScreenControlPlugin): Tool {
  const params = z.object({
    maxDepth: z.number().int().min(1).max(50).default(10),
    maxNodes: z.number().int().min(1).max(20_000).default(1200),
  })

  const TOKYO_NIGHT_SUCCESS = { r: 158, g: 206, b: 106 } // #9ece6a
  function rgb({ r, g, b }: { r: number; g: number; b: number }, text: string) {
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
  }

  return {
    name: 'get_ui_tree',
    description:
      'Inspect the frontmost app UI via native Accessibility tree (stable ids) and return simplified JSON nodes + a compact label→id index.',
    parameters: params,
    execute: async ({ maxDepth, maxNodes }) => {
      try {
        const context = plugin.context
        if (!context) {
          return { success: false, error: 'ScreenControl plugin is not initialized.' }
        }

        const cached = plugin.cachedTree
        const now = Date.now()
        if (cached && now - cached.atMs < 2_000) {
          return {
            success: true,
            result: cached.payloadJson,
            metadata: { ...cached.metadata, cached: true },
          }
        }

        const tree = await context.requireBridge().getUiTree(maxDepth, maxNodes)
        const beforeChars = JSON.stringify(tree).length

        const prunedRoot = pruneUiTree((tree as any).root)
        const prunedTree = { ...(tree as any), root: prunedRoot }
        const afterChars = JSON.stringify(prunedTree).length
        const reductionPct =
          beforeChars > 0
            ? Math.max(0, Math.round(((beforeChars - afterChars) / beforeChars) * 1000) / 10)
            : 0

        context.logger.system(
          rgb(
            TOKYO_NIGHT_SUCCESS,
            `[Apex] UI Pruned: Reduced payload by ${reductionPct}% (Before: ${beforeChars} chars -> After: ${afterChars} chars).`,
          ),
        )

        const root: unknown = (prunedTree as any).root
        const nodes = walkNodes(root)
        const labelIndex: Record<string, string[]> = {}
        for (const node of nodes) {
          if (!node.id) continue
          const label = (node.label ?? '').trim().toLowerCase()
          if (!label) continue
          const list = labelIndex[label] ?? []
          if (list.length < 20) {
            list.push(node.id)
          }
          labelIndex[label] = list
        }

        const payload = {
          tree: prunedTree,
          index: {
            labelToIds: labelIndex,
          },
        }

        const payloadJson = JSON.stringify(payload)
        plugin.cachedTree = {
          atMs: (prunedTree as any).capturedAtMs ?? Date.now(),
          payloadJson,
          metadata: {
            appName: (prunedTree as any).appName,
            capturedAtMs: (prunedTree as any).capturedAtMs,
            limits: (prunedTree as any).limits,
            hasStableIds: true,
          },
        }

        return {
          success: true,
          result: payloadJson,
          metadata: plugin.cachedTree.metadata,
        }
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)
        const diagnosis = (error as any)?.nativeBridge?.systemHint
          ? { systemHint: (error as any).nativeBridge.systemHint }
          : undefined
        return { success: false, error: message, diagnosis }
      }
    },
  }
}

function buildUiClickElementTool(plugin: ScreenControlPlugin): Tool {
  const params = z.object({
    label: z
      .string()
      .min(1)
      .describe('Label to match from the AX tree (case-insensitive; matches label/description-like text).'),
    screenWidth: z
      .number()
      .int()
      .min(1)
      .max(16_384)
      .optional()
      .describe('Optional screen width for tie-breaking.'),
    screenHeight: z
      .number()
      .int()
      .min(1)
      .max(16_384)
      .optional()
      .describe('Optional screen height for tie-breaking.'),
  })

  return {
    name: 'ui_click_element',
    description:
      'Click a UI element identified by label from the native accessibility tree (prefers enabled + visible matches).',
    parameters: params,
    execute: async ({ label, screenWidth, screenHeight }) => {
      try {
        const context = plugin.context
        if (!context) {
          return { success: false, error: 'ScreenControl plugin is not initialized.' }
        }

        const tree = await context.requireBridge().getUiTree(10, 5000)
        const nodes = walkNodes((tree as any).root)

        const target = label.trim().toLowerCase()
        let candidates = nodes
          .filter((node) => isFrame(node.frame))
          .filter((node) => {
            const text = (node.label ?? '').trim().toLowerCase()
            return text === target || text.includes(target)
          })

        const enabledVisible = candidates.filter((node) => node.enabled !== false && node.hidden !== true)
        if (enabledVisible.length > 0) {
          candidates = enabledVisible
        }

        if (candidates.length === 0) {
          return { success: false, error: 'No matching element found in the AX tree.' }
        }

        const w = screenWidth ?? 1440
        const h = screenHeight ?? 900
        const screenCenter = { x: w / 2, y: h / 2 }

        let best = candidates[candidates.length - 1]
        let bestScore = Number.POSITIVE_INFINITY

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i]
          const frame = candidate.frame!
          const c = centerOf(frame)
          const score = dist2(c, screenCenter)
          if (score < bestScore || (score === bestScore && i === candidates.length - 1)) {
            bestScore = score
            best = candidate
          }
        }

        const frame = best.frame!
        const point = centerOf(frame)
        await clickAt(point.x, point.y)
        recordEnergyImpact('semantic_click')

        return {
          success: true,
          result: `Clicked label="${label}" at {${Math.round(point.x)}, ${Math.round(point.y)}}`,
          metadata: {
            matchedId: best.id,
            matchedLabel: best.label,
            matchedEnabled: best.enabled,
            matchedHidden: best.hidden,
            frame,
          },
        }
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error)
        const diagnosis = (error as any)?.nativeBridge?.systemHint
          ? { systemHint: (error as any).nativeBridge.systemHint }
          : undefined
        return { success: false, error: message, diagnosis }
      }
    },
  }
}

export default class ScreenControlPlugin implements OpenMacPlugin {
  context: PluginContext | null = null
  cachedTree: null | {
    atMs: number
    payloadJson: string
    metadata: Record<string, unknown>
  } = null

  private buildPayload(tree: any): { payloadJson: string; metadata: Record<string, unknown> } {
    const prunedRoot = pruneUiTree(tree?.root)
    const prunedTree = { ...(tree as any), root: prunedRoot }
    const root: unknown = prunedTree?.root
    const nodes = walkNodes(root)
    const labelIndex: Record<string, string[]> = {}
    for (const node of nodes) {
      if (!node.id) continue
      const label = (node.label ?? '').trim().toLowerCase()
      if (!label) continue
      const list = labelIndex[label] ?? []
      if (list.length < 20) {
        list.push(node.id)
      }
      labelIndex[label] = list
    }

    const payload = {
      tree: prunedTree,
      index: {
        labelToIds: labelIndex,
      },
    }

    return {
      payloadJson: JSON.stringify(payload),
      metadata: {
        appName: prunedTree?.appName,
        capturedAtMs: prunedTree?.capturedAtMs,
        limits: prunedTree?.limits,
        hasStableIds: true,
      },
    }
  }

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context
    context.logger.system('ScreenControl loaded.')
  }

  async onUnload(): Promise<void> {
    // No-op: tool registry currently does not support unregistering.
  }

  async onEvent(_event: SystemEvent): Promise<void> {
    if (_event.type !== 'WINDOW_FOCUS') return
    if (!this.context) return

    // Warm the AX tree cache when the user changes frontmost apps.
    try {
      const tree = await this.context.requireBridge().getUiTree(10, 1200)
      const built = this.buildPayload(tree as any)
      this.cachedTree = {
        atMs: (tree as any).capturedAtMs ?? Date.now(),
        payloadJson: built.payloadJson,
        metadata: { ...built.metadata, warmedBy: 'WINDOW_FOCUS' },
      }
    } catch {
      // Ignore: focus events should never break the app.
    }
  }

  async callTool(toolName: string, args: unknown): Promise<unknown> {
    if (!this.context) {
      return { success: false, error: 'ScreenControl plugin is not initialized.' }
    }

    if (toolName === 'get_ui_tree') {
      const tool = buildGetUiTreeTool(this)
      return await tool.execute(args as any)
    }

    if (toolName === 'ui_click_element') {
      const tool = buildUiClickElementTool(this)
      return await tool.execute(args as any)
    }

    return { success: false, error: `Unknown tool: ${toolName}` }
  }
}
