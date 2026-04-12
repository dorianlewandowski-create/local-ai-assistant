import fs from 'fs'
import os from 'os'
import path from 'path'
import chalk from 'chalk'
import enquirer from 'enquirer'
import { config } from '@apex/core'
import { runtimeConfig, saveConfigPatch } from './runtime'
import { createRuntimeServiceClient } from '../runtime/serviceClient'
import type { SubAgentKind } from '@apex/types'
import { fetchJsonWithTimeout } from '../runtime/fetchWithTimeout'

const TOKYO = {
  cyan: chalk.hex('#7dcfff'),
  storm: chalk.hex('#565f89'),
  magenta: chalk.hex('#bb9af7'),
  green: chalk.hex('#9ece6a'),
}

const OLLAMA_TAGS_TIMEOUT_MS = 8_000

async function fetchLocalModels(): Promise<string[]> {
  const host = config.ollama.host || 'http://127.0.0.1:11434'
  const json = await fetchJsonWithTimeout<any>(
    `${host.replace(/\/$/, '')}/api/tags`,
    { method: 'GET' },
    { timeoutMs: OLLAMA_TAGS_TIMEOUT_MS },
  )
  const models = Array.isArray(json?.models) ? json.models : []
  const names = models.map((m: any) => String(m?.name ?? '')).filter(Boolean)
  return names.sort((a: string, b: string) => a.localeCompare(b))
}

export async function showModelMenu(): Promise<void> {
  try {
    let localModels: string[] = []
    try {
      const names = await fetchLocalModels()
      localModels = names.map((n) => `Local: ${n}`)
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.log(
        chalk.hex('#bb9af7')(
          `\n[Apex] Warning: Could not connect to Ollama (${error.message}). Is it running?`,
        ),
      )
    }

    const choices = ['✨ Auto-Select (Optimum)', 'Gemini 3.1 Pro (API)', ...localModels]

    const prompt = new (enquirer as any).Select({
      name: 'model',
      message: TOKYO.cyan('Select active AI model'),
      choices,
    })

    const selectedModel = String(await prompt.run())

    if (selectedModel.startsWith('✨')) {
      runtimeConfig.modelMode = 'auto'
      runtimeConfig.lockedModel = ''
      saveConfigPatch({
        modelMode: 'auto',
        lockedModel: '',
        app: { statusAiLabel: 'AUTO' },
      })
      // eslint-disable-next-line no-console
      console.log(TOKYO.green('[Apex] Model router set to ✨ Auto-Select (prompt-based tiers).'))

      // Restore smart routing in the daemon.
      try {
        const client = createRuntimeServiceClient()
        await client.setRouterMode('smart')
      } catch {
        // ignore
      }
      return
    }

    if (selectedModel === 'Gemini 3.1 Pro (API)') {
      const geminiKey = config.apiKeys.gemini?.trim()
      if (!geminiKey) {
        // eslint-disable-next-line no-console
        console.log(
          chalk.hex('#bb9af7')(
            '\n[Apex] Error: No Gemini API key configured (GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY). Aborting.',
          ),
        )
        return
      }
      runtimeConfig.activeModel = 'gemini-3.1-pro-preview'
      runtimeConfig.modelMode = 'manual'
      runtimeConfig.lockedModel = 'gemini'
      saveConfigPatch({
        modelMode: 'manual',
        lockedModel: 'gemini',
        current_provider: 'gemini',
        models: {
          ...config.models,
          geminiModel: 'gemini-3.1-pro-preview',
          tiers: {
            ...config.models.tiers,
            reasoning: 'gemini-3.1-pro-preview',
            coding: 'gemini-3.1-pro-preview',
          },
        },
        app: { statusAiLabel: 'GEMINI' },
      })
      // eslint-disable-next-line no-console
      console.log(TOKYO.green('[Apex] Active model set to Gemini 3.1 Pro (preview).'))

      // Apply live runtime preference in the daemon so routing actually uses Gemini.
      try {
        const client = createRuntimeServiceClient()
        await client.setActiveBrain('gemini')
        await client.setRouterMode('always_gemini')
      } catch {
        // ignore (daemon may be down)
      }
      return
    }

    const localName = selectedModel.replace(/^Local:\s*/i, '').trim()
    runtimeConfig.activeModel = localName
    runtimeConfig.modelMode = 'manual'
    runtimeConfig.lockedModel = localName
    saveConfigPatch({
      modelMode: 'manual',
      lockedModel: localName,
      current_provider: 'local',
      models: { chat: localName },
      app: { statusAiLabel: localName },
    })
    // eslint-disable-next-line no-console
    console.log(TOKYO.green(`[Apex] Active model set to ${localName}.`))

    // Apply live runtime preference in the daemon.
    try {
      const client = createRuntimeServiceClient()
      await client.setActiveBrain('local')
      await client.setRouterMode('always_local')
    } catch {
      // ignore (daemon may be down)
    }
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.log(TOKYO.magenta(`[Apex] Model menu failed: ${error?.message ?? String(error)}`))
  }
}

function discoverSdkPlugins(): string[] {
  const pluginsDir = path.join(process.cwd(), 'src', 'plugins')
  if (!fs.existsSync(pluginsDir)) return []
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
}

export async function showPluginMenu(): Promise<void> {
  try {
    const plugins = discoverSdkPlugins()
    const current = Array.isArray((config as any)?.plugins?.allowlist)
      ? ((config as any).plugins.allowlist as string[])
      : []

    const prompt = new (enquirer as any).MultiSelect({
      name: 'plugins',
      message: TOKYO.cyan('Select enabled SDK plugins'),
      choices: plugins.map((p) => ({ name: p, value: p })),
      initial: current,
    })

    const selected = (await prompt.run()) as string[]
    saveConfigPatch({
      plugins: {
        ...(typeof (config as any).plugins === 'object' ? (config as any).plugins : {}),
        allowlist: selected,
      },
    })

    // eslint-disable-next-line no-console
    console.log(TOKYO.green(`[Apex] Plugin allowlist updated (${selected.length} enabled).`))
    // We don't have safe tool-unregister/rebind yet, so restart is the cleanest apply.
    // eslint-disable-next-line no-console
    console.log(TOKYO.storm('[Apex] Restart required to apply plugin changes.'))
    process.exit(0)
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.log(TOKYO.magenta(`[Apex] Plugin menu failed: ${error?.message ?? String(error)}`))
  }
}

const TERMINAL_CLI_SOURCE = 'terminal' as const
const TERMINAL_CLI_SOURCE_ID = 'local-console'

export async function showAgentMenu(): Promise<void> {
  try {
    const client = createRuntimeServiceClient()
    let current: 'auto' | SubAgentKind = 'auto'
    try {
      const k = await client.getSessionSubAgentKind(TERMINAL_CLI_SOURCE, TERMINAL_CLI_SOURCE_ID)
      current = k == null ? 'auto' : k
    } catch {
      // Daemon may be down; still offer local UI to queue preference when it returns.
    }

    const mark = (key: 'auto' | SubAgentKind) => (current === key ? ' — current' : '')

    const choices = [
      `✨ Auto (heuristic)${mark('auto')}`,
      `Researcher${mark('researcher')}`,
      `Coder${mark('coder')}`,
      `System${mark('system')}`,
    ]

    const prompt = new (enquirer as any).Select({
      name: 'subagent',
      message: TOKYO.cyan('Sub-agent routing (this terminal session)'),
      choices,
    })

    const picked = String(await prompt.run())
    let kind: SubAgentKind | 'auto'
    if (picked.startsWith('✨')) {
      kind = 'auto'
    } else if (picked.startsWith('Researcher')) {
      kind = 'researcher'
    } else if (picked.startsWith('Coder')) {
      kind = 'coder'
    } else {
      kind = 'system'
    }

    await client.setSessionSubAgentKind(
      TERMINAL_CLI_SOURCE,
      TERMINAL_CLI_SOURCE_ID,
      kind === 'auto' ? 'auto' : kind,
    )
    if (kind === 'auto') {
      // eslint-disable-next-line no-console
      console.log(TOKYO.green('[Apex] Sub-agent: auto (heuristic routing).'))
    } else {
      // eslint-disable-next-line no-console
      console.log(TOKYO.green(`[Apex] Sub-agent: ${kind}.`))
    }
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.log(TOKYO.magenta(`[Apex] Sub-agent menu failed: ${error?.message ?? String(error)}`))
  }
}

export async function showSessionMenu(): Promise<void> {
  try {
    const sessionsDir = path.join(os.homedir(), '.apex', 'data', 'sessions')
    const files = fs.existsSync(sessionsDir)
      ? fs
          .readdirSync(sessionsDir)
          .filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
          .sort()
          .reverse()
      : []

    const choices = ['[+ Start New Session]', ...files]
    const prompt = new (enquirer as any).Select({
      name: 'session',
      message: TOKYO.cyan('Switch session'),
      choices,
    })

    const picked = String(await prompt.run())
    if (picked === '[+ Start New Session]') {
      // eslint-disable-next-line no-console
      console.log(TOKYO.green('[Apex] Starting a new session (best-effort).'))
      // Session isolation is handled server-side today; CLI just informs.
      return
    }

    // eslint-disable-next-line no-console
    console.log(TOKYO.green(`[Apex] Selected session file: ${picked}`))
    // Loading into active LLM context is runtime-managed today; CLI just informs.
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.log(TOKYO.magenta(`[Apex] Session menu failed: ${error?.message ?? String(error)}`))
  }
}

export async function showCommandPalette(): Promise<void> {
  const prompt = new (enquirer as any).Select({
    name: 'palette',
    message: TOKYO.cyan('Apex Command Palette'),
    choices: [
      '🧠 Change AI Model',
      '🎯 Sub-agent routing',
      '🔌 Manage Plugins',
      '📁 Switch Session',
      '🧹 Clear Screen',
      '❌ Exit',
    ],
  })

  const choice = String(await prompt.run())
  if (choice.startsWith('🧠')) return await showModelMenu()
  if (choice.startsWith('🎯')) return await showAgentMenu()
  if (choice.startsWith('🔌')) return await showPluginMenu()
  if (choice.startsWith('📁')) return await showSessionMenu()
  if (choice.startsWith('🧹')) {
    // eslint-disable-next-line no-console
    console.clear()
    // eslint-disable-next-line no-console
    console.log(TOKYO.storm('[Apex] Cleared.'))
    return
  }
  if (choice.startsWith('❌')) {
    // eslint-disable-next-line no-console
    console.log(TOKYO.storm('[Apex] Shutting down...'))
    process.exit(0)
  }
}
