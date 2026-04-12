import fs from 'fs'
import { execFileSync } from 'child_process'
import os from 'os'
import { config, type ApexConfig } from '@apex/core'
import { fetchJsonWithTimeout, STARTUP_OLLAMA_TAGS_TIMEOUT_MS } from './runtime/fetchWithTimeout'

function normalizeOllamaHost(raw: string): string {
  const v = String(raw ?? '').trim()
  if (!v) return 'http://127.0.0.1:11434'
  if (/^https?:\/\//i.test(v)) return v
  // Common first-boot env: "127.0.0.1:11434" (no scheme). Treat as http.
  return `http://${v}`
}

function ensureLocalOllamaHost(ollamaHostRaw: string): string {
  const ollamaHost = normalizeOllamaHost(ollamaHostRaw)
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(ollamaHost)) {
    throw new Error(`Ollama must be local-only. Invalid OLLAMA_HOST: ${ollamaHostRaw}`)
  }
  return ollamaHost
}

function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function verifyOllamaConnection(ollamaHost: string): Promise<void> {
  try {
    await fetchJsonWithTimeout(
      `${ollamaHost.replace(/\/$/, '')}/api/tags`,
      { method: 'GET' },
      {
        timeoutMs: STARTUP_OLLAMA_TAGS_TIMEOUT_MS,
        timeoutMessage: `Ollama health check timed out after ${STARTUP_OLLAMA_TAGS_TIMEOUT_MS}ms`,
      },
    )
  } catch (error: any) {
    console.warn(
      `[⚠️ Ollama not reachable] Not detected at ${ollamaHost}. Start Ollama to enable local AI features.`,
    )

    // Keep retrying in the background so Ollama can come online after boot.
    let attempts = 0
    const timer = setInterval(async () => {
      attempts += 1
      try {
        await fetchJsonWithTimeout(
          `${ollamaHost.replace(/\/$/, '')}/api/tags`,
          { method: 'GET' },
          {
            timeoutMs: STARTUP_OLLAMA_TAGS_TIMEOUT_MS,
            timeoutMessage: `Ollama retry timed out after ${STARTUP_OLLAMA_TAGS_TIMEOUT_MS}ms`,
          },
        )
        console.warn(`[Ollama] Detected at ${ollamaHost}. Local AI features are now available.`)
        clearInterval(timer)
      } catch {
        if (attempts % 6 === 0) {
          console.warn(`[Ollama] Still waiting at ${ollamaHost}...`)
        }
      }
    }, 10_000)
    ;(timer as any).unref?.()

    // Non-fatal: allow Apex to start in offline mode.
    return
  }
}

function validateVectorStorePath(activeConfig: ApexConfig): string[] {
  const warnings: string[] = []
  const vectorStorePath = activeConfig.storage.vectorStorePath

  if (vectorStorePath.startsWith('/Volumes/') && !fs.existsSync(vectorStorePath)) {
    throw new Error('🚨 VAULT NOT FOUND: Please mount your encrypted ApexData volume to continue.')
  }

  try {
    fs.mkdirSync(vectorStorePath, { recursive: true })
    fs.accessSync(vectorStorePath, fs.constants.R_OK | fs.constants.W_OK)
  } catch {
    warnings.push(
      `Configured VECTOR_STORE_PATH is not writable: ${vectorStorePath}. Apex will fall back to the local data directory.`,
    )
  }

  return warnings
}

export async function validateStartup(activeConfig: ApexConfig = config): Promise<string[]> {
  if (os.platform() !== 'darwin') {
    throw new Error('Apex requires macOS.')
  }

  const ollamaHost = ensureLocalOllamaHost(activeConfig.ollama.host)

  const missingRequiredCommands = ['osascript', 'screencapture'].filter((command) => !commandExists(command))
  if (missingRequiredCommands.length > 0) {
    throw new Error(`Missing required macOS commands: ${missingRequiredCommands.join(', ')}`)
  }

  const warnings = [...validateVectorStorePath(activeConfig)]

  const missingOptionalCommands = ['pmset', 'uptime'].filter((command) => !commandExists(command))
  if (missingOptionalCommands.length > 0) {
    warnings.push(
      `Optional commands unavailable: ${missingOptionalCommands.join(', ')}. Some status features may be limited.`,
    )
  }

  if (activeConfig.gateways.telegram.enabled) {
    if (!activeConfig.gateways.telegram.botToken || !activeConfig.gateways.telegram.chatId) {
      throw new Error('Telegram is enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.')
    }
  }

  if (
    activeConfig.gateways.whatsapp.enabled &&
    activeConfig.gateways.whatsapp.executablePath &&
    !fs.existsSync(activeConfig.gateways.whatsapp.executablePath)
  ) {
    warnings.push(
      `Configured PUPPETEER_EXECUTABLE_PATH does not exist: ${activeConfig.gateways.whatsapp.executablePath}`,
    )
  }

  await verifyOllamaConnection(ollamaHost)

  return warnings
}
