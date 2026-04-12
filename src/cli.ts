import './loadEnv'
import chalk from 'chalk'
import type { SubAgentKind } from '@apex/types'
import { config, loadConfig, type ApexConfig } from '@apex/core'
import { runDoctor } from './doctor'
import { runDaemon } from './runtime/daemon'
import { runOnboard } from './onboard'
import { installLaunchdPlist } from './launchd'
import { runUpdateHelp } from './update'
import { runReleasePack, runReleaseVerify } from './release'
import { runPairing } from './pairing'
import { createRuntimeServiceClient } from './runtime/serviceClient'
import { resolveCliCommand } from './index'
import { formatApexVersionLine } from './cliVersion'
import { registerCoreTools } from './core/registerTools'
import { toolRegistry } from './tools/registry'
import { nativeBridge } from '@apex/macos-node'
import boxen from 'boxen'
import readline from 'readline'
import { ShortcutManager, registerCoreShortcuts } from './core/shortcuts'
import {
  showAgentMenu,
  showCommandPalette,
  showModelMenu,
  showPluginMenu,
  showSessionMenu,
} from './core/menus'
import {
  formatDashboardModelsLineFromConfig,
  formatDashboardPrivacyLabel,
  formatDashboardProviderLabel,
} from './core/router'
import fs from 'fs'
import path from 'path'
import { logger } from './utils/logger'
import { TerminalRenderer } from './ui/terminalRenderer'
import { emitDebugLog } from './runtime/debugIngest'
import { newCorrelationId } from './utils/correlationId'
import { runFilesCli } from './filesPreviewCli'
import { printApexCliHelp } from './cliHelp'
import { formatRuntimeClientError, isLikelyDaemonUnreachable } from './runtime/runtimeClientMessages'
import { runRuntimeInfo } from './runtime/runtimeInfo'

function exitWithRuntimeCliError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(chalk.red(formatRuntimeClientError(msg)))
  process.exit(1)
}

function mergeCorrelation(payload: any, correlationId?: string) {
  if (!correlationId) return payload
  return {
    ...payload,
    correlationId,
    data:
      payload?.data != null && typeof payload.data === 'object'
        ? { ...payload.data, correlationId }
        : payload.data,
  }
}

function debugLog(payload: any, correlationId?: string) {
  emitDebugLog(mergeCorrelation(payload, correlationId) as Record<string, unknown>)
}

/**
 * In the TUI, users often type `apex doctor` like the shell. Map that to `/doctor` so we do not
 * send it to the LLM (which would hit Ollama and show a timeout).
 */
function mapApexShellLineToSlashCommand(line: string): string {
  const trimmed = line.trim()
  const m = trimmed.match(/^apex\s+(\S+)(\s+.*)?$/i)
  if (!m) return line
  const sub = m[1].toLowerCase()
  const tail = (m[2] ?? '').trim()
  const map: Record<string, string> = {
    doctor: '/doctor',
    help: '/help',
    exit: '/exit',
    quit: '/exit',
    clear: '/clear',
  }
  const slash = map[sub]
  if (!slash) return line
  return tail ? `${slash} ${tail}` : slash
}

const TOKYO_NIGHT = {
  apexCyan: chalk.hex('#7dcfff'),
  stormGrey: chalk.hex('#565f89'),
  sandboxMagenta: chalk.hex('#bb9af7'),
  successGreen: chalk.hex('#9ece6a'),
}

/** Hard deadline so the readline handler always settles even if fetch misbehaves (keeps stdin usable). */
function withPromptDeadline<T>(promise: Promise<T>, label = 'prompt'): Promise<T> {
  const ms = Math.max(
    30_000,
    Math.min(180_000, Number(process.env.APEX_CLI_PROMPT_DEADLINE_MS || 0) || 127_000),
  )
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: deadline exceeded (${ms}ms)`)), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

type DashboardRow = { type: 'Native' | 'Plugin'; namespace: string; capability: string }

/** Session key for TUI ↔ runtime HTTP client (submitPrompt, sub-agent). Matches showAgentMenu / local-console. */
const TUI_TASK_SOURCE = 'terminal' as const
const TUI_TASK_SOURCE_ID = 'local-console'

function formatSubAgentBanner(kind: SubAgentKind | null): string {
  if (kind == null) return '✨ auto (heuristic)'
  return `🎯 ${kind} (override)`
}

function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function createPrompt(): string {
  return `[${TOKYO_NIGHT.stormGrey('󱐋')} ${TOKYO_NIGHT.apexCyan('apex')}] ${TOKYO_NIGHT.stormGrey('❯')} `
}

function renderDashboard(
  status: {
    daemon: string
    bridge: string
    uptime: string
    model: string
    provider: string
    privacy: string
    subAgent: string
  },
  rows: DashboardRow[],
): string {
  const header = boxen(`▲ ${chalk.bold('APEX CONTROL PLANE')}`, {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: '#7dcfff',
    textAlignment: 'center',
  })

  const out: string[] = []
  out.push('\x1b[2J\x1b[H') // clear screen + home cursor
  out.push(header)
  out.push('')

  // Status (resolved config — not raw env)
  out.push(`  Daemon: ${status.daemon.padEnd(14)}Bridge: ${status.bridge}`)
  out.push(`  Uptime: ${status.uptime.padEnd(14)}Model: ${status.model}`)
  out.push(`  Provider: ${status.provider.padEnd(12)}Privacy: ${status.privacy}`)
  out.push(`  Sub-agent: ${status.subAgent}`)
  out.push('')

  out.push(chalk.bold.hex('#7dcfff')('\n  ● ACTIVE MODULES'))
  out.push('    ' + chalk.hex('#9ece6a')('native') + '    [core]              70+ capabilities active')

  const pluginTools = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.type !== 'Plugin') continue
    const pluginId = row.namespace
    const parts = row.capability.split('.')
    const toolName = parts.length > 1 ? parts.slice(1).join('.') : row.capability
    const set = pluginTools.get(pluginId) ?? new Set<string>()
    set.add(toolName)
    pluginTools.set(pluginId, set)
  }

  for (const [pluginId, tools] of [...pluginTools.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const list = [...tools.values()].sort((a, b) => a.localeCompare(b)).join(', ')
    out.push('    ' + chalk.hex('#bb9af7')('plugin') + `    [${pluginId}]     ${list}`)
  }

  out.push('')
  return out.join('\n')
}

function clearAndRenderDashboard(
  status: {
    daemon: string
    bridge: string
    uptime: string
    model: string
    provider: string
    privacy: string
    subAgent: string
  },
  rows: DashboardRow[],
): string {
  return renderDashboard(status, rows)
}

function warnIfPlaceholderGeminiKey(projectConfig: ApexConfig): void {
  const k = projectConfig.apiKeys.gemini?.trim() ?? ''
  const badGemini = !k || k.includes('your_')
  if (badGemini) {
    logger.warn(
      chalk.hex('#bb9af7')(
        '[Apex] ⚠️ Warning: Gemini API key is missing or using a placeholder. Set GEMINI_API_KEY or GOOGLE_GEMINI_API_KEY in your .env file.',
      ),
    )
  }
}

async function runInfo(projectConfig: ApexConfig, args: string[] = []): Promise<void> {
  const startedAt = Date.now()
  const shortcuts = new ShortcutManager()
  registerCoreShortcuts(shortcuts)

  const wantPluginsOnly = args.includes('--plugins-only')
  const wantNativeOnly = args.includes('--native-only')
  const filterIndex = args.findIndex((a) => a === '--filter')
  const filter =
    filterIndex >= 0
      ? String(args[filterIndex + 1] ?? '')
          .trim()
          .toLowerCase()
      : ''

  const tools = toolRegistry.getAllTools()
  const rows = tools
    .map((t) => {
      const isPlugin = t.name.includes('.')
      const [maybePluginId, ...rest] = t.name.split('.')
      const toolName = isPlugin ? rest.join('.') : t.name
      return {
        type: isPlugin ? 'Plugin' : 'Native',
        ns: isPlugin ? maybePluginId : 'core',
        name: isPlugin ? `${maybePluginId}.${toolName}` : toolName,
        desc: t.description ?? '',
      }
    })
    .filter((row) => {
      if (wantPluginsOnly && row.type !== 'Plugin') return false
      if (wantNativeOnly && row.type !== 'Native') return false
      if (filter) {
        const hay = `${row.type} ${row.ns} ${row.name} ${row.desc}`.toLowerCase()
        return hay.includes(filter)
      }
      return true
    })
    .sort((a, b) => (a.type + a.ns + a.name).localeCompare(b.type + b.ns + b.name))

  let model = formatDashboardModelsLineFromConfig(projectConfig)
  let provider = formatDashboardProviderLabel(projectConfig)
  const privacy = formatDashboardPrivacyLabel(projectConfig)

  const status = {
    daemon: 'Active',
    bridge: nativeBridge.isActive() ? 'Connected (Swift)' : 'Disconnected',
    uptime: formatUptime(Date.now() - startedAt),
    model,
    provider,
    privacy,
    subAgent: formatSubAgentBanner(null),
  }

  const runtimeClient = createRuntimeServiceClient()
  try {
    const k = await runtimeClient.getSessionSubAgentKind(TUI_TASK_SOURCE, TUI_TASK_SOURCE_ID)
    status.subAgent = formatSubAgentBanner(k)
  } catch {
    status.subAgent = formatSubAgentBanner(null)
  }

  const tableRows: DashboardRow[] = rows.map((r) => ({
    type: r.type as 'Native' | 'Plugin',
    namespace: r.ns,
    capability: r.name,
  }))

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '',
  })

  // Ensure interactive stdin is flowing and decoded properly.
  process.stdin.setEncoding('utf8')
  process.stdin.resume()

  // Use readline's prompt machinery (renderer relies on rl.prompt(true)).
  rl.setPrompt(createPrompt())

  const renderer = new TerminalRenderer(rl, createPrompt)

  // Single-writer: route all logs (and patched console) to the renderer.
  logger.setSink({
    appendChat: (_role, text) => {
      renderer.logBackground('chat', text)
    },
    appendMonologue: (kind, text) => {
      const mapped = kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'info'
      renderer.logBackground(mapped as any, text)
    },
    setStatus: (text) => {
      renderer.logBackground('system', text)
    },
  })
  logger.patchConsole()

  shortcuts.register({
    name: '/doctor',
    description: 'Run Apex Doctor (config + daemon /health; does not use the LLM).',
    execute: async () => {
      await runDoctor((line) => renderer.printForeground(line))
    },
  })

  // Render the banner/dashboard once at boot. Background tasks must never clear/redraw the full screen.
  renderer.printForeground(clearAndRenderDashboard(status, tableRows))

  const context = {
    // Intentionally does not clear/redraw the full banner. Keep it stable after boot.
    printDashboard: () => {
      status.uptime = formatUptime(Date.now() - startedAt)
    },
    sleepWorkers: async () => {
      // Best-effort placeholder: workers already self-sleep when idle.
      // Hook a real implementation here if/when we expose a worker-manager API.
    },
  }

  // Live state sync: polling must not redraw while readline is accepting input,
  // otherwise it will corrupt the user's current line buffer.
  let dashboardTimer: NodeJS.Timeout | null = null
  let awaitingInput = true
  /** Prevents overlapping daemon calls; do NOT use rl.pause() — it freezes input if HTTP never returns. */
  let promptInFlight = false
  let lastPolledStatus: { model: string; provider: string; subAgent: string } | null = null

  const applyRuntimeSnapshotToBanner = (snapshot: any) => {
    const active = snapshot?.activeModel as
      | { provider: 'gemini' | 'local'; model: string; tier?: string; updatedAt: string; note?: string }
      | null
      | undefined
    if (active) {
      const label = active.provider === 'gemini' ? 'Gemini' : 'Local'
      status.provider = label
      status.model = `⚡ ACTIVE (${label}: ${active.model}${active.tier ? ` | ${active.tier}` : ''})`
      return
    }

    // If we haven't routed a prompt yet, show current runtime preference.
    const settings = snapshot?.settings as
      | { activeBrain?: 'local' | 'gemini'; routerMode?: 'always_gemini' | 'always_local' | 'smart' }
      | undefined
    const brain = settings?.activeBrain === 'gemini' ? 'Gemini' : 'Local'
    const mode = settings?.routerMode ?? 'smart'
    status.provider = brain
    status.model =
      mode === 'always_gemini'
        ? '☁️ CLOUD (Gemini forced)'
        : mode === 'always_local'
          ? '🧠 LOCAL (Local forced)'
          : '✨ AUTO (Smart routing)'
  }

  const pollAndRender = async () => {
    if (awaitingInput) return
    try {
      const snapshot = await runtimeClient.getStatusSnapshot()
      applyRuntimeSnapshotToBanner(snapshot as any)
      const k = await runtimeClient.getSessionSubAgentKind(TUI_TASK_SOURCE, TUI_TASK_SOURCE_ID)
      status.subAgent = formatSubAgentBanner(k)
    } catch {
      // Runtime may be down; keep config-derived display.
      status.model = model
      status.provider = provider
      status.subAgent = formatSubAgentBanner(null)
    } finally {
      status.uptime = formatUptime(Date.now() - startedAt)
      // Never redraw the banner/dashboard from background polling.
      // If something changed, emit a single safe log line above the prompt.
      if (
        !lastPolledStatus ||
        lastPolledStatus.model !== status.model ||
        lastPolledStatus.provider !== status.provider ||
        lastPolledStatus.subAgent !== status.subAgent
      ) {
        lastPolledStatus = { model: status.model, provider: status.provider, subAgent: status.subAgent }
        logger.system(
          `[Status] Provider: ${status.provider} | Model: ${status.model} | Sub-agent: ${status.subAgent}`,
        )
      }
    }
  }

  const startLivePolling = () => {
    if (dashboardTimer) return
    dashboardTimer = setInterval(() => {
      void pollAndRender()
    }, 2000)
    ;(dashboardTimer as any).unref?.()
  }

  const stopLivePolling = () => {
    if (!dashboardTimer) return
    clearInterval(dashboardTimer)
    dashboardTimer = null
  }

  let overlayActive = false
  const runOverlay = async (fn: () => Promise<void>, opts: { redrawAfter?: boolean } = {}) => {
    if (overlayActive) return
    overlayActive = true
    stopLivePolling()
    awaitingInput = true
    renderer.setState('OverlayMenu')
    rl.pause()
    const overlayMs = Math.max(
      15_000,
      Math.min(600_000, Number(process.env.APEX_CLI_OVERLAY_DEADLINE_MS || 0) || 180_000),
    )
    // Prevent the safe logger from trying to redraw the apex prompt while Enquirer is drawing.
    try {
      await Promise.race([
        fn(),
        new Promise<void>((_, rej) =>
          setTimeout(
            () => rej(new Error(`[Apex] Overlay timed out (${Math.floor(overlayMs / 1000)}s).`)),
            overlayMs,
          ),
        ),
      ])
    } catch (e: any) {
      renderer.printForeground(TOKYO_NIGHT.stormGrey(`[Apex] ${e?.message ?? String(e)}`))
    } finally {
      rl.resume()
      overlayActive = false
      renderer.setState('IdleTyping')
      if (opts.redrawAfter) {
        // Explicit user action; refresh banner from live runtime state.
        try {
          const snapshot = await runtimeClient.getStatusSnapshot()
          applyRuntimeSnapshotToBanner(snapshot as any)
        } catch {
          // ignore
        }
        try {
          const k = await runtimeClient.getSessionSubAgentKind(TUI_TASK_SOURCE, TUI_TASK_SOURCE_ID)
          status.subAgent = formatSubAgentBanner(k)
        } catch {
          status.subAgent = formatSubAgentBanner(null)
        }
        redraw()
      }
      rl.prompt(true)
    }
  }

  // Palette shortcuts (slash aliases)
  shortcuts.register({
    name: '/model',
    description: 'Open the model selector.',
    execute: async () => {
      await runOverlay(showModelMenu, { redrawAfter: true })
    },
  })
  shortcuts.register({
    name: '/plugins',
    description: 'Open the plugin manager.',
    execute: async () => {
      await runOverlay(showPluginMenu)
    },
  })
  shortcuts.register({
    name: '/session',
    description: 'Open the session switcher.',
    execute: async () => {
      await runOverlay(showSessionMenu)
    },
  })
  shortcuts.register({
    name: '/agent',
    description: 'Choose sub-agent mode (researcher / coder / system) or auto.',
    execute: async () => {
      await runOverlay(showAgentMenu, { redrawAfter: true })
    },
  })
  shortcuts.register({
    name: '/gemini-test',
    description: 'Send a heavy prompt to verify Gemini API connectivity.',
    execute: async () => {
      const correlationId = newCorrelationId()
      const testPrompt =
        'Explain the CAP theorem with 2 concrete database examples and trade-offs. Keep it concise.'
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'C6',
          location: 'src/cli.ts:/gemini-test',
          message: 'Running Gemini connectivity test',
          data: { len: testPrompt.length },
          timestamp: Date.now(),
        },
        correlationId,
      )

      if (promptInFlight) {
        renderer.printForeground(
          TOKYO_NIGHT.stormGrey('[Apex] Please wait for the current request to finish.'),
        )
        return
      }
      promptInFlight = true
      awaitingInput = false
      renderer.setState('Thinking')
      try {
        const client = createRuntimeServiceClient()
        debugLog(
          {
            sessionId: '35112d',
            runId: 'gemini-check',
            hypothesisId: 'C6b',
            location: 'src/cli.ts:/gemini-test',
            message: 'Forcing runtime to Gemini for test',
            data: {},
            timestamp: Date.now(),
          },
          correlationId,
        )
        try {
          await client.setActiveBrain('gemini' as any)
          await client.setRouterMode('always_gemini' as any)
        } catch (err: any) {
          debugLog(
            {
              sessionId: '35112d',
              runId: 'gemini-check',
              hypothesisId: 'C6c',
              location: 'src/cli.ts:/gemini-test',
              message: 'Could not force runtime settings',
              data: { msg: String(err?.message ?? err ?? '').slice(0, 180) },
              timestamp: Date.now(),
            },
            correlationId,
          )
        }
        const responseText = await withPromptDeadline(
          client.submitPrompt('terminal', 'local-console', testPrompt, {
            executionProvider: 'gemini',
            correlationId,
          }),
          'Gemini test prompt',
        )
        const normalized = String(responseText ?? '')
        debugLog(
          {
            sessionId: '35112d',
            runId: 'gemini-check',
            hypothesisId: 'C7',
            location: 'src/cli.ts:/gemini-test',
            message: 'Gemini test received response',
            data: { trimLen: normalized.trim().length, prefix: normalized.trim().slice(0, 120) },
            timestamp: Date.now(),
          },
          correlationId,
        )
        renderer.setState('Printing')
        renderer.printForeground(normalized.trim().length ? normalized : '[Apex] Empty response.')
      } catch (err: any) {
        debugLog(
          {
            sessionId: '35112d',
            runId: 'gemini-check',
            hypothesisId: 'C8',
            location: 'src/cli.ts:/gemini-test',
            message: 'Gemini test threw',
            data: { msg: String(err?.message ?? err ?? '').slice(0, 180) },
            timestamp: Date.now(),
          },
          correlationId,
        )
        const gErr = String(err?.message ?? err ?? '')
        renderer.printForeground(
          TOKYO_NIGHT.stormGrey(
            isLikelyDaemonUnreachable(gErr) ? formatRuntimeClientError(gErr) : `(gemini-test failed) ${gErr}`,
          ),
        )
      } finally {
        stopLivePolling()
        awaitingInput = true
        promptInFlight = false
        renderer.setState('IdleTyping')
      }
    },
  })

  // Note: We intentionally avoid global raw-mode key listeners here.
  // They can interfere with readline/enquirer input handling and cause double-echo.

  // If stdout is not a TTY (piped output), don't start an interactive prompt.
  // This keeps `apex info | head` and similar commands from crashing with EPIPE.
  if (!process.stdout.isTTY) {
    rl.close()
    return
  }

  const redraw = () => {
    status.uptime = formatUptime(Date.now() - startedAt)
    renderer.printForeground(clearAndRenderDashboard(status, tableRows))
    rl.prompt(true)
  }

  // While readline is paused, Ctrl+C may not surface as expected — always resume then close.
  process.on('SIGINT', () => {
    try {
      stopLivePolling()
    } catch {
      // ignore
    }
    try {
      rl.resume()
    } catch {
      // ignore
    }
    try {
      rl.close()
    } catch {
      process.exit(130)
    }
  })
  rl.on('close', () => {
    stopLivePolling()
  })
  rl.on('close', () => {
    renderer.printForeground('')
    process.exit(0)
  })

  rl.on('line', async (line) => {
    const input = String(line ?? '').trim()
    debugLog({
      sessionId: '35112d',
      runId: 'gemini-check',
      hypothesisId: 'C1',
      location: 'src/cli.ts:onLine',
      message: 'CLI received line',
      data: { len: input.length, startsWithSlash: input.startsWith('/') },
      timestamp: Date.now(),
    })
    if (!input) {
      rl.prompt()
      return
    }

    const promptUser = () => {
      rl.prompt()
    }

    let text = input.trim()
    text = mapApexShellLineToSlashCommand(text)
    if (text.startsWith('/')) {
      debugLog({
        sessionId: '35112d',
        runId: 'gemini-check',
        hypothesisId: 'C2',
        location: 'src/cli.ts:onLine',
        message: 'Handling slash command',
        data: { cmd: text.slice(0, 40) },
        timestamp: Date.now(),
      })
      const ok = await shortcuts.handle(text, context)
      if (!ok) {
        renderer.printForeground(TOKYO_NIGHT.stormGrey(`[Apex] Unknown command: ${text}. Try /help`))
      }
      return promptUser()
    }

    if (promptInFlight) {
      renderer.printForeground(
        TOKYO_NIGHT.stormGrey('[Apex] Still processing your previous message. Please wait.'),
      )
      rl.prompt()
      return
    }
    promptInFlight = true

    // Transition: Typing -> Thinking
    awaitingInput = false
    renderer.setState('Thinking')
    const correlationId = newCorrelationId()
    debugLog(
      {
        sessionId: '35112d',
        runId: 'gemini-check',
        hypothesisId: 'C3',
        location: 'src/cli.ts:onLine',
        message: 'Submitting prompt to daemon',
        data: { len: input.length },
        timestamp: Date.now(),
      },
      correlationId,
    )
    // Do NOT call rl.pause(): if the runtime hangs, pause() leaves stdin dead (no /exit, no Ctrl+C via readline).

    try {
      const client = createRuntimeServiceClient()
      const responseText = await withPromptDeadline(
        client.submitPrompt('terminal', 'local-console', input, { correlationId }),
        'Runtime prompt',
      )
      const normalized = String(responseText ?? '')
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'C4',
          location: 'src/cli.ts:onLine',
          message: 'Daemon returned response',
          data: { trimLen: normalized.trim().length },
          timestamp: Date.now(),
        },
        correlationId,
      )
      if (normalized.trim().length === 0) {
        renderer.printForeground(
          TOKYO_NIGHT.stormGrey(
            '[Apex] (No response text returned. This usually indicates an upstream model error. Try `apex doctor` or check ~/Library/Logs/Apex/daemon.err.log.)',
          ),
        )
      } else {
        // Print responses directly (do not depend on patched console output).
        renderer.setState('Printing')
        renderer.printForeground(normalized)
      }
    } catch (err: any) {
      debugLog(
        {
          sessionId: '35112d',
          runId: 'gemini-check',
          hypothesisId: 'C5',
          location: 'src/cli.ts:onLine',
          message: 'Prompt submission error',
          data: { msg: String(err?.message ?? err ?? '').slice(0, 180) },
          timestamp: Date.now(),
        },
        correlationId,
      )
      const raw = String(err?.message ?? err ?? '')
      const timedOut = /timeout|aborted|abort/i.test(raw)
      renderer.printForeground(
        TOKYO_NIGHT.stormGrey(
          timedOut
            ? `[Apex] Request timed out waiting for the runtime (daemon). Check that Apex is running and not stuck, then try again.\n${raw}`
            : formatRuntimeClientError(raw),
        ),
      )
    } finally {
      // Transition: Thinking -> Typing
      stopLivePolling()
      awaitingInput = true
      promptInFlight = false
      renderer.setState('IdleTyping')
    }

    promptUser()
  })

  rl.prompt()
  return new Promise<void>(() => {})
}

function logFatalError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log')
  const message = `[${new Date().toISOString()}] FATAL ERROR (CLI): ${error.stack || error.message}\n`
  fs.appendFileSync(logPath, message)
  console.error(message)
}

export async function runCliMain() {
  // When output is piped and the reader closes early (e.g. `apex ... | head`),
  // Node throws/raises EPIPE. Treat it as a clean exit (no crash/no stack).
  const handleEpipe = (err: any) => {
    if (err?.code === 'EPIPE') process.exit(0)
  }
  process.stdout.on('error', handleEpipe)
  process.stderr.on('error', handleEpipe)

  const rawArgv = process.argv.slice(2)
  const resolvedEarly = resolveCliCommand(rawArgv)
  if (resolvedEarly.command === 'help') {
    printApexCliHelp()
    process.exit(0)
  }

  if (resolvedEarly.command === 'version') {
    process.stdout.write(`${formatApexVersionLine()}\n`)
    process.exit(0)
  }

  if (resolvedEarly.command === 'files') {
    const code = await runFilesCli(resolvedEarly.argv)
    process.exit(code)
  }

  let projectConfig: ApexConfig
  try {
    projectConfig = await Promise.resolve(loadConfig())
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`[Apex] Failed to load configuration: ${msg}`))
    console.error(chalk.hex('#565f89')('Fix apex.json / environment variables and try again.'))
    process.exit(1)
  }

  // Ensure no early-phase stdout writes (plugins/tooling can log during startup).
  // Route early logs to data/debug.log until the interactive TerminalRenderer is initialized.
  logger.setSink({
    appendChat: (_role, text) => {
      try {
        const dir = path.join(process.cwd(), 'data')
        fs.mkdirSync(dir, { recursive: true })
        fs.appendFileSync(path.join(dir, 'debug.log'), `[${new Date().toISOString()}] CHAT ${text}\n`, 'utf8')
      } catch {
        // ignore
      }
    },
    appendMonologue: (kind, text) => {
      try {
        const dir = path.join(process.cwd(), 'data')
        fs.mkdirSync(dir, { recursive: true })
        fs.appendFileSync(
          path.join(dir, 'debug.log'),
          `[${new Date().toISOString()}] ${kind.toUpperCase()} ${text}\n`,
          'utf8',
        )
      } catch {
        // ignore
      }
    },
    setStatus: (text) => {
      try {
        const dir = path.join(process.cwd(), 'data')
        fs.mkdirSync(dir, { recursive: true })
        fs.appendFileSync(
          path.join(dir, 'debug.log'),
          `[${new Date().toISOString()}] STATUS ${text}\n`,
          'utf8',
        )
      } catch {
        // ignore
      }
    },
  })
  logger.patchConsole()

  warnIfPlaceholderGeminiKey(projectConfig)

  await registerCoreTools()
  const resolved = resolveCliCommand(rawArgv)

  if (resolved.command === 'info') {
    await runInfo(projectConfig, process.argv.slice(2))
    // runInfo is interactive when TTY; don't force exit.
    if (!process.stdout.isTTY) process.exit(0)
    return
  }

  // Avoid polluting machine-readable output.
  const isMachineReadable =
    resolved.command === 'service-status' ||
    resolved.command === 'service-approvals' ||
    resolved.command === 'service-sessions'
  // OpenClaw-style dashboard framing is only for `info`.
  // Other commands keep output clean (especially those that exit immediately).

  if (resolved.command === 'doctor') {
    const exitCode = await runDoctor()
    process.exit(exitCode)
  }

  if (resolved.command === 'runtime-info') {
    const json = resolved.argv.includes('--json')
    const exitCode = await runRuntimeInfo(console.log, { json })
    process.exit(exitCode)
  }

  if (resolved.command === 'onboard') {
    const exitCode = await runOnboard()
    process.exit(exitCode)
  }

  if (resolved.command === 'launchd-install') {
    const exitCode = await installLaunchdPlist()
    process.exit(exitCode)
  }

  if (resolved.command === 'daemon') {
    await runDaemon()
    return
  }

  if (resolved.command === 'update') {
    const exitCode = await runUpdateHelp()
    process.exit(exitCode)
  }

  if (resolved.command === 'release-pack') {
    const exitCode = await runReleasePack()
    process.exit(exitCode)
  }

  if (resolved.command === 'release-verify') {
    const exitCode = await runReleaseVerify()
    process.exit(exitCode)
  }

  if (resolved.command === 'pairing') {
    const exitCode = await runPairing(resolved.argv)
    process.exit(exitCode)
  }

  if (resolved.command === 'service-status') {
    try {
      const client = createRuntimeServiceClient()
      const snapshot = await client.getStatusSnapshot()
      console.log(JSON.stringify(snapshot, null, 2))
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-safe') {
    const value = resolved.argv[0]?.toLowerCase()
    if (value !== 'on' && value !== 'off') {
      throw new Error('Usage: apex service-safe <on|off>')
    }
    try {
      const client = createRuntimeServiceClient()
      await client.setRemoteSafeMode(value === 'on')
      console.log(`Remote-safe mode set to ${value}.`)
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-model') {
    const [source, sourceId, ...modelParts] = resolved.argv
    const model = modelParts.join(' ').trim()
    if (!source || !sourceId || !model) {
      throw new Error('Usage: apex service-model <source> <sourceId> <model>')
    }
    try {
      const client = createRuntimeServiceClient()
      await client.setSessionModel(source as any, sourceId, model)
      console.log(`Runtime service model updated for ${source}:${sourceId}.`)
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-sandbox') {
    const [source, sourceId, mode] = resolved.argv
    if (!source || !sourceId || !mode || !['default', 'strict', 'off'].includes(mode)) {
      throw new Error('Usage: apex service-sandbox <source> <sourceId> <default|strict|off>')
    }
    try {
      const client = createRuntimeServiceClient()
      await client.setSessionSandboxMode(source as any, sourceId, mode as 'default' | 'strict' | 'off')
      console.log(`Runtime service sandbox updated for ${source}:${sourceId}.`)
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-approvals') {
    try {
      const client = createRuntimeServiceClient()
      const approvals = await client.listPendingApprovals()
      console.log(JSON.stringify(approvals, null, 2))
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-approve') {
    const [id] = resolved.argv
    if (!id) {
      throw new Error('Usage: apex service-approve <id>')
    }
    try {
      const client = createRuntimeServiceClient()
      const ok = await client.settleApproval(id, true)
      console.log(ok ? `Approved ${id}.` : `Approval ${id} was not found.`)
      process.exit(ok ? 0 : 1)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-deny') {
    const [id] = resolved.argv
    if (!id) {
      throw new Error('Usage: apex service-deny <id>')
    }
    try {
      const client = createRuntimeServiceClient()
      const ok = await client.settleApproval(id, false)
      console.log(ok ? `Denied ${id}.` : `Approval ${id} was not found.`)
      process.exit(ok ? 0 : 1)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  if (resolved.command === 'service-sessions') {
    try {
      const client = createRuntimeServiceClient()
      const sessions = await client.listSessions()
      console.log(JSON.stringify(sessions, null, 2))
      process.exit(0)
    } catch (e) {
      exitWithRuntimeCliError(e)
    }
  }

  // Default `apex` experience: show the dashboard + readline loop.
  await runInfo(projectConfig, process.argv.slice(2))
}

// Note: `src/cliBundle.ts` is the supported entrypoint for running the CLI.
