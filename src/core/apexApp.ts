import { logger } from '../utils/logger'
import { config } from '@apex/core'
import { validateStartup } from '../startupValidation'
import { sessionStore } from '../runtime/sessionStore'
import { createRuntimeHost } from '../runtime/runtimeHost'
import { createRuntimeServiceClient } from '../runtime/serviceClient'
import { runNativeBridgeStartupDiagnostic } from '../runtime/nativeBridgeDiagnostic'
import { readRuntimeServiceToken } from '../runtime/runtimeServiceToken'
import { isRuntimeHealthOk } from '../runtime/runtimeHealth'
import { isRuntimeHttpUnauthorized } from '../runtime/runtimeClientMessages'
import fs from 'fs'
import path from 'path'
import { getRouterStatusMode } from './router'

function logStartupError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log')
  const message = `[${new Date().toISOString()}] STARTUP ERROR: ${error.stack || error.message}\n`
  fs.appendFileSync(logPath, message)
  console.error(message)
}

export async function runApex(argv: string[] = process.argv.slice(2)) {
  try {
    const healthOk = await isRuntimeHealthOk()
    const tokenOnDisk = readRuntimeServiceToken()

    if (healthOk && !tokenOnDisk) {
      logger.warn(
        '[Apex] The runtime daemon responds on /health, but this process could not read a runtime auth token (~/.apex/runtime.token or APEX_RUNTIME_TOKEN*). Restart the daemon once (`apex daemon` or launchctl kickstart) or align APEX_STATE_DIR. See docs/OPERATOR_TRUST.txt and `apex runtime-info`.',
      )
      logger.warn(`Runtime service URL: http://127.0.0.1:${config.runtimeService.port}`)
      return
    }

    let isRunning = false
    if (tokenOnDisk) {
      const client = createRuntimeServiceClient()
      try {
        await client.getStatusSnapshot()
        isRunning = true
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        if (healthOk && isRuntimeHttpUnauthorized(msg)) {
          logger.warn(
            '[Apex] The runtime daemon is reachable but the auth token was rejected (401). Align ~/.apex/runtime.token (or env) with the running daemon—often after moving the install tree or changing APEX_STATE_DIR. Try restarting the daemon; see docs/OPERATOR_TRUST.txt and `apex runtime-info`.',
          )
          logger.warn(`Runtime service URL: ${client.getBaseUrl()}`)
          return
        }
      }
    }

    if (isRunning) {
      logger.system('Runtime service already running.')
      logger.system(`Runtime service: http://127.0.0.1:${config.runtimeService.port}`)
      return
    }

    const startupWarnings = await validateStartup()
    for (const warning of startupWarnings) {
      logger.warn(warning)
    }

    runNativeBridgeStartupDiagnostic()
    await sessionStore.loadFromDisk()

    const prompt = argv.join(' ').trim()
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
      logger.status(runtimeHost.getStatusLine(pulse, mode))
    }

    const shutdown = async () => {
      if (shuttingDown) {
        return
      }

      shuttingDown = true
      logger.system('Shutting down...')
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
    runtimeHost.startLifecycle(shutdown)

    logger.system('Resident mode active')
    logger.system(`Watching: ${config.watcher.directories.join(', ')}`)

    await runtimeHost.start()

    updateStatus()
    statusInterval = setInterval(updateStatus, 5000)

    // Stay alive
    return new Promise<void>(() => {})
  } catch (error: any) {
    logStartupError(error)
    throw error
  }
}
