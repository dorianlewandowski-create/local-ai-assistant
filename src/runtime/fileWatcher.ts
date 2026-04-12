import chokidar from 'chokidar'
import path from 'path'
import fs from 'fs/promises'
import { TaskQueue } from './taskQueue'
import { logger } from '../utils/logger'
import { config } from '@apex/core'

function shouldHandleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return config.watcher.extensions.has(ext)
}

async function buildFileEventPrompt(eventType: 'add' | 'change', filePath: string): Promise<string> {
  const stats = await fs.stat(filePath)
  const ext = path.extname(filePath).toLowerCase() || 'no extension'
  const sizeKb = Math.max(1, Math.round(stats.size / 1024))

  return [
    'Resident event detected.',
    `Event: ${eventType}.`,
    `Path: ${filePath}.`,
    `Extension: ${ext}.`,
    `SizeKB: ${sizeKb}.`,
    'Analyze whether this file needs organization, review, summarization, or user notification.',
    'If the event reveals a stable user preference or pattern, save it as a fact.',
    'If memory might help, recall relevant facts before deciding what to do.',
    'Finish only after deciding on the best next action.',
  ].join(' ')
}

export function startResidentFileWatcher(taskQueue: TaskQueue, onTaskSettled: () => void) {
  const watcher = chokidar.watch(config.watcher.directories, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  })

  // Debounce bursts of changes to the same path (e.g., IDE save storms) so we
  // don't enqueue dozens of expensive tasks for a single edit session.
  const DEBOUNCE_MS = 2000
  const pending = new Map<string, { timer: NodeJS.Timeout; eventType: 'add' | 'change'; lastAtMs: number }>()

  const enqueueDebounced = (eventType: 'add' | 'change', filePath: string) => {
    if (!shouldHandleFile(filePath)) return

    const existing = pending.get(filePath)
    if (existing) {
      clearTimeout(existing.timer)
      existing.eventType = eventType
      existing.lastAtMs = Date.now()
    }

    const timer = setTimeout(async () => {
      pending.delete(filePath)
      try {
        const label = `${eventType}:${path.basename(filePath)}`
        const eventPrompt = await buildFileEventPrompt(eventType, filePath)
        const result = await taskQueue.safeEnqueue({
          id: `${label}-${Date.now()}`,
          source: 'file_watcher',
          sourceId: 'resident-watch',
          prompt: eventPrompt,
          metadata: { eventType, filePath },
          timeoutMs: 60_000,
        })
        logger.chat('assistant', `[FileWatcher] ${result.response}`)
        onTaskSettled()
      } catch (error: any) {
        logger.error(`[FileWatcher] Failed to enqueue debounced event: ${error?.message ?? String(error)}`)
      }
    }, DEBOUNCE_MS)
    ;(timer as any).unref?.()
    pending.set(filePath, { timer, eventType, lastAtMs: Date.now() })
  }

  watcher.on('add', (filePath: string) => {
    enqueueDebounced('add', filePath)
  })

  watcher.on('change', (filePath: string) => {
    enqueueDebounced('change', filePath)
  })

  watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Watcher error: ${message}`)
  })

  return watcher
}
