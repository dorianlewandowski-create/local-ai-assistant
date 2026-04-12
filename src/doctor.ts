import { config } from '@apex/core'
import { validateStartup } from './startupValidation'
import { DOCTOR_HTTP_TIMEOUT_MS, fetchTextWithTimeout } from './runtime/fetchWithTimeout'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { getLaunchdPlistPath } from './launchd'
import { getDefaultRuntimeServiceTokenPath } from './runtime/runtimeServiceToken'
import os from 'os'
import path from 'path'

const LAUNCHD_LABEL = 'ai.apex.agent'

function guiUserId(): number {
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

function tryLaunchctlPrintJob(): string {
  if (process.platform !== 'darwin') return '(launchctl: not macOS)'
  try {
    return execFileSync('launchctl', ['print', `gui/${guiUserId()}/${LAUNCHD_LABEL}`], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
    }).trim()
  } catch (e: any) {
    const stderr = e?.stderr ? String(e.stderr) : ''
    return (stderr.trim() || String(e?.message ?? e)).trim()
  }
}

export async function runDoctor(write: (line: string) => void = console.log): Promise<number> {
  write('Apex Doctor')
  write(`Config file: ${config.meta.configPath ?? 'none'}`)
  write(`Ollama host: ${config.ollama.host}`)
  write(`Vector store: ${config.storage.vectorStorePath}`)
  write(`Session store: ${config.storage.sessionStorePath}`)
  write(`Telegram enabled: ${config.gateways.telegram.enabled ? 'yes' : 'no'}`)
  write(`WhatsApp enabled: ${config.gateways.whatsapp.enabled ? 'yes' : 'no'}`)
  write(`Discord enabled: ${config.gateways.discord.enabled ? 'yes' : 'no'}`)
  const plistPath = getLaunchdPlistPath()
  write(
    `launchd plist file: ${existsSync(plistPath) ? `present (${plistPath})` : 'missing (npm run launchd:install)'}`,
  )

  // Daemon health check + log locations (critical for post-reboot troubleshooting).
  let daemonHealthy = false
  const baseUrl = `http://127.0.0.1:${config.runtimeService.port}`
  try {
    const {
      ok: httpOk,
      status,
      text,
    } = await fetchTextWithTimeout(
      `${baseUrl}/health`,
      { method: 'GET' },
      {
        timeoutMs: DOCTOR_HTTP_TIMEOUT_MS,
        timeoutMessage: `Daemon health check timed out after ${DOCTOR_HTTP_TIMEOUT_MS}ms`,
      },
    )
    daemonHealthy = httpOk && text.trim() === 'ok'
    write(`Daemon health: ${daemonHealthy ? 'OK' : `FAILED (HTTP ${status}, body not "ok")`} (${baseUrl})`)
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    write(`Daemon health: FAILED (${msg}) (${baseUrl})`)
  }

  const runtimeTokenPath = getDefaultRuntimeServiceTokenPath()
  if (daemonHealthy) {
    write(`Runtime API auth token file: ${runtimeTokenPath}`)
    write(
      '  (/api/* requires Bearer or X-Apex-Token; GET /health is unauthenticated — docs/OPERATOR_TRUST.txt)',
    )
    write('  Full snapshot (no secret values): apex runtime-info')
  } else {
    write(`Runtime API token file (after a successful daemon start): ${runtimeTokenPath}`)
    write(
      '  If /api/* returns 401, the client token does not match the daemon (stale file or APEX_STATE_DIR mismatch).',
    )
    write('  Diagnose: apex runtime-info')
  }

  if (!daemonHealthy) {
    write('')
    write('--- Why: nothing is listening for the runtime HTTP API ---')
    write(`The CLI/TUI need the daemon at ${baseUrl}/health (see APEX / apex.json runtimeService.port).`)
    write('')
    write('Option A — run in foreground (good for debugging):')
    write('  cd /path/to/mac-ai-assistant   # repo root')
    write('  apex daemon')
    write('')
    write('Option B — launchd (plist file alone is NOT enough; you must load the job):')
    if (existsSync(plistPath)) {
      write(`  launchctl bootstrap gui/${guiUserId()} "${plistPath}"`)
      write(`  launchctl kickstart -k gui/${guiUserId()}/${LAUNCHD_LABEL}`)
      write(`If the plist points at the wrong folder, reinstall from repo root: npm run launchd:install`)
    } else {
      write(`  npm run launchd:install`)
      write(`  launchctl bootstrap gui/${guiUserId()} "${plistPath}"`)
    }
    if (process.platform === 'darwin') {
      const snap = tryLaunchctlPrintJob()
      write('')
      write(`launchctl print gui/${guiUserId()}/${LAUNCHD_LABEL}:`)
      const lines = snap.split('\n').slice(0, 30)
      for (const line of lines) {
        write(`  ${line}`)
      }
      if (snap && snap.split('\n').length > 30) {
        write('  …')
      }
    }
    write('')
    write('If the job keeps dying, read:')
    write(`  ${path.join(os.homedir(), 'Library', 'Logs', 'Apex', 'daemon.err.log')}`)
  }

  const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Apex')
  write(`Daemon logs: ${path.join(logDir, 'daemon.out.log')}`)
  write(`Daemon errors: ${path.join(logDir, 'daemon.err.log')}`)

  try {
    const warnings = await validateStartup(config)
    if (warnings.length === 0) {
      write('Startup checks: OK')
    } else {
      write('Startup checks: OK with warnings')
      for (const warning of warnings) {
        write(`Warning: ${warning}`)
      }
      write('Recovery hints:')
      write('- If Ollama is unavailable, start it and verify OLLAMA_HOST')
      write('- If Telegram is enabled, confirm TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID')
      write('- If storage paths fail, inspect permissions on data/ and configured paths')
    }

    return 0
  } catch (error: any) {
    write(`Startup checks: FAILED`)
    write(`Error: ${error.message}`)
    write('Recovery hints:')
    write('- Run apex onboard to create missing local config files')
    write('- Review .env and apex.json values')
    write('- Confirm macOS privacy permissions and local Ollama availability')
    return 1
  }
}
