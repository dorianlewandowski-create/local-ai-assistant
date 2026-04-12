import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import type { EnergyImpactRecorder } from '@apex/gateway-shared'

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

const captureMutex = new AsyncMutex()
let lastCaptureAtMs = 0
let lastCapturePath: string | null = null

export interface ScreenshotCaptureOptions {
  maxAgeMs?: number
  signal?: AbortSignal
  energyImpact?: EnergyImpactRecorder
}

export async function captureScreenshot(
  filePath: string,
  options: ScreenshotCaptureOptions = {},
): Promise<void> {
  await captureMutex.runExclusive(async () => {
    const now = Date.now()

    if (options.maxAgeMs && lastCapturePath === filePath && now - lastCaptureAtMs <= options.maxAgeMs) {
      const stats = await fs.stat(filePath).catch(() => null)
      if (stats && now - stats.mtimeMs <= options.maxAgeMs) {
        return
      }
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => undefined)

    await execFileAsync('screencapture', ['-x', filePath], {
      signal: options.signal as any,
      windowsHide: true,
    })
    options.energyImpact?.recordEnergyImpact('screenshot')

    const stats = await fs.stat(filePath).catch(() => null)
    if (!stats || stats.size <= 0) {
      throw new Error(`Screenshot capture failed or produced empty file: ${filePath}`)
    }

    lastCaptureAtMs = now
    lastCapturePath = filePath
  })
}

export async function cleanupScreenshot(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => undefined)
}
