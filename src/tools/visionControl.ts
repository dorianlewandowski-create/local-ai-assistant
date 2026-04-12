import { z } from 'zod'
import type { Tool } from '@apex/types'
import { toolRegistry } from './registry'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { config } from '@apex/core'
import { fetchJsonWithTimeout, OLLAMA_GENERATION_TIMEOUT_MS } from '../runtime/fetchWithTimeout'
import { recordEnergyImpact } from '../utils/energyImpact'

const execFileAsync = promisify(execFile)

class AsyncMutex {
  private last: Promise<void> = Promise.resolve()

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.last
    let release!: () => void
    this.last = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

const visionMutex = new AsyncMutex()

export interface VisionSnapshotOptions {
  /**
   * Ollama multimodal model name.
   *
   * @defaultValue `"llava"`
   */
  model?: string
  /**
   * If true, keeps the captured screenshot on disk at `screenshotPath`.
   * Keeping a single stable path is generally safe; it avoids unbounded file growth.
   *
   * @defaultValue `true`
   */
  keepScreenshotFile?: boolean
  /**
   * Optional AbortSignal to cancel the `screencapture` process and/or the Ollama request.
   */
  signal?: AbortSignal
  /**
   * Minimum time between captures. If hit, the most recent cached result is returned.
   * Set to `0` to disable rate limiting.
   *
   * @defaultValue `config.performance.visionMinCaptureIntervalMs` (default 500ms)
   */
  minCaptureIntervalMs?: number
}

export interface VisionSnapshotResult {
  /**
   * The model's natural-language response.
   */
  response: string
  /**
   * Path to the screenshot used as vision input.
   */
  screenshotPath: string
  /**
   * Model name that was requested.
   */
  model: string
}

interface CachedVisionResult {
  result: VisionSnapshotResult
  capturedAtMs: number
}

let lastVision: CachedVisionResult | null = null

/**
 * Capture a screenshot and analyze it using an Ollama multimodal model.
 *
 * This function applies backpressure (one in-flight vision request at a time) to keep the daemon
 * responsive and reduce background CPU/memory churn under bursty workloads.
 *
 * @param query - What you want to locate/understand on the current screen.
 * @param options - Vision execution options (model, cancellation, file retention).
 * @returns The model response plus metadata about the snapshot.
 * @throws If screenshot capture or the Ollama request fails.
 */
export async function getScreenSnapshot(
  query: string,
  options: VisionSnapshotOptions = {},
): Promise<VisionSnapshotResult> {
  const model = options.model ?? 'llava'
  const keepScreenshotFile = options.keepScreenshotFile ?? true
  const screenshotPath = path.join(process.cwd(), 'data', 'vision_input.png')
  const minIntervalMs = Math.max(
    0,
    options.minCaptureIntervalMs ?? config.performance.visionMinCaptureIntervalMs,
  )

  return visionMutex.runExclusive(async () => {
    const now = Date.now()
    if (minIntervalMs > 0 && lastVision && now - lastVision.capturedAtMs < minIntervalMs) {
      return lastVision.result
    }

    await fs.mkdir(path.dirname(screenshotPath), { recursive: true }).catch(() => undefined)

    await execFileAsync('screencapture', ['-x', screenshotPath], {
      windowsHide: true,
      signal: options.signal as any,
    })
    recordEnergyImpact('vision_screenshot')

    try {
      const imageBuffer = await fs.readFile(screenshotPath)
      const base64Image = imageBuffer.toString('base64')

      const data: any = await fetchJsonWithTimeout(
        `${config.ollama.host}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: `${query}\nPlease provide your response. If you are identifying coordinates, try to estimate them in {x, y} format for a standard 1440x900 screen if possible.`,
            images: [base64Image],
            stream: false,
          }),
        },
        { timeoutMs: OLLAMA_GENERATION_TIMEOUT_MS, signal: options.signal },
      )
      const result: VisionSnapshotResult = {
        response: String(data?.response ?? ''),
        screenshotPath,
        model,
      }
      lastVision = { result, capturedAtMs: now }
      return result
    } finally {
      if (!keepScreenshotFile) {
        await fs.unlink(screenshotPath).catch(() => undefined)
      }
    }
  })
}

/**
 * Click at a specific screen coordinate using AppleScript UI scripting.
 *
 * @param x - Horizontal coordinate in screen pixels.
 * @param y - Vertical coordinate in screen pixels.
 * @param signal - Optional AbortSignal for the underlying `osascript` process.
 */
export async function clickAt(x: number, y: number, signal?: AbortSignal): Promise<void> {
  await execFileAsync('osascript', ['-e', `tell application "System Events" to click at {${x}, ${y}}`], {
    windowsHide: true,
    signal: signal as any,
  })
}

const VisionGetScreenSnapshotParams = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'What you are looking for on the screen (e.g., "Find the Send button", "Describe the current window").',
    ),
})

/**
 * Tool wrapper around {@link getScreenSnapshot}.
 */
export const visionGetScreenSnapshot: Tool<typeof VisionGetScreenSnapshotParams> = {
  name: 'vision_get_screen_snapshot',
  description:
    'Take a screenshot and analyze it using a multimodal AI model. Use this to find UI elements that are not accessible via AppleScript.',
  parameters: VisionGetScreenSnapshotParams,
  execute: async ({ query }) => {
    try {
      const result = await getScreenSnapshot(query, { keepScreenshotFile: true })
      return {
        success: true,
        result: result.response,
        metadata: { screenshotPath: result.screenshotPath, model: result.model },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    } finally {
      // Screenshot is written to a stable path (overwritten each time) to avoid unbounded disk growth.
    }
  },
}

const VisionClickAtParams = z.object({
  x: z.number().describe('Horizontal coordinate.'),
  y: z.number().describe('Vertical coordinate.'),
})

/**
 * Tool wrapper around {@link clickAt}.
 */
export const visionClickAt: Tool<typeof VisionClickAtParams> = {
  name: 'vision_click_at',
  description:
    'Perform a mouse click at the specified screen coordinates. Use vision_get_screen_snapshot first to find coordinates.',
  parameters: VisionClickAtParams,
  execute: async ({ x, y }) => {
    try {
      await clickAt(x, y)
      return { success: true, result: `Clicked at {${x}, ${y}}` }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  },
}

toolRegistry.register(visionGetScreenSnapshot)
toolRegistry.register(visionClickAt)
