import '../loadEnv'
import { logger } from '../utils/logger'
import { config } from '@apex/core'
import { validateStartup } from '../startupValidation'
import { sessionStore } from './sessionStore'
import { createRuntimeHost } from './runtimeHost'
import { registerCoreTools } from '../core/registerTools'
import { runNativeBridgeStartupDiagnostic } from './nativeBridgeDiagnostic'
import fs from 'fs'
import path from 'path'
import { getRouterStatusMode } from '../core/router'

async function logDaemonError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log')
  const message = `[${new Date().toISOString()}] DAEMON ERROR: ${error.stack || error.message}\n`
  await fs.promises.appendFile(logPath, message)
  console.error(message)
}

export async function runDaemon() {
  try {
    // Global error handling (graceful degradation).
    // We log and keep the daemon alive so a single unexpected exception doesn't kill the listener.
    // Note: uncaughtException indicates a potentially inconsistent state; we choose availability
    // over strict fail-fast because this daemon is long-running and user-controlled.
    process.on('uncaughtException', (error) => {
      void logDaemonError(error)
      logger.error(`[Daemon] Uncaught exception: ${error?.message ?? String(error)}`)
    })
    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason))
      void logDaemonError(err)
      logger.error(`[Daemon] Unhandled rejection: ${err?.message ?? String(err)}`)
    })

    const startupWarnings = await validateStartup()
    for (const warning of startupWarnings) {
      logger.warn(warning)
    }

    await registerCoreTools()
    runNativeBridgeStartupDiagnostic()
    await sessionStore.loadFromDisk()

    let pulseIndex = 0
    const pulseFrames = ['·', '•', '◦', '•']
    let shuttingDown = false
    let statusInterval: NodeJS.Timeout | null = null
    let runtimeHost: ReturnType<typeof createRuntimeHost>

    const updateStatus = () => {
      const snapshot = runtimeHost.getQueueSnapshot()
      const activeTasks = snapshot.active
      const pulse = activeTasks > 0 ? pulseFrames[pulseIndex++ % pulseFrames.length] : '●'
      const mode = getRouterStatusMode(activeTasks)
      // Important: printing a dynamic status line from a backgrounded daemon will
      // corrupt interactive readline prompts in the same terminal. Keep this opt-in.
      if (process.env.APEX_DAEMON_TTY_STATUS === '1') {
        logger.status(runtimeHost.getStatusLine(pulse, mode))
      }
    }

    const shutdown = async () => {
      if (shuttingDown) {
        return
      }

      shuttingDown = true
      logger.system('Daemon shutting down...')
      if (statusInterval) {
        clearInterval(statusInterval)
      }
      if (runtimeHost) {
        await runtimeHost.stop()
      }
      process.exit(0)
    }

    runtimeHost = createRuntimeHost(updateStatus, () => {
      if (!shuttingDown) void shutdown()
    })

    // Single registration: attachProcessLifecycle handles SIGINT/SIGTERM (avoid duplicate handlers).
    runtimeHost.startLifecycle(shutdown)

    logger.system('Resident daemon active')
    logger.system(`Watching: ${config.watcher.directories.join(', ')}`)

    await runtimeHost.start()
    updateStatus()
    statusInterval = setInterval(updateStatus, 5000)
    ;(statusInterval as any).unref?.()

    // Stay alive
    return new Promise<void>(() => {})
  } catch (error: any) {
    await logDaemonError(error)
    throw error
  }
}
