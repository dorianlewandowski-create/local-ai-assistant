import { TaskQueue } from './taskQueue'
import { createProactiveScheduler } from './proactiveScheduler'
import { startResidentFileWatcher } from './fileWatcher'

export function createRuntimeRunner(taskQueue: TaskQueue, onStatusChange: () => void) {
  const proactiveScheduler = createProactiveScheduler(taskQueue, onStatusChange)
  let watcher: ReturnType<typeof startResidentFileWatcher> | null = null

  return {
    start() {
      proactiveScheduler.start()
      watcher = startResidentFileWatcher(taskQueue, onStatusChange)
    },
    async stop() {
      proactiveScheduler.stop()
      await watcher?.close()
      watcher = null
    },
  }
}
