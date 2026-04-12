import fs from 'fs'
import path from 'path'
import { logger as rootLogger } from '../utils/logger'
import { MacSandbox } from '../sandbox/MacSandbox'
import { nativeBridge } from '@apex/macos-node'
import { recordEnergyImpact } from '../utils/energyImpact'
import { performance } from 'perf_hooks'
import type {
  OpenMacPluginMetadata,
  PluginEnergyScore,
  PluginPermission,
  ScopedLogger,
  SystemEvent,
} from '../sdk/types'
import { PluginWorker } from './PluginWorker'
import { toolRegistry } from '../tools/registry'
import { z } from 'zod'

type DiscoveredPlugin = {
  id: string
  rootDir: string
  entryPath: string
}

function makeScopedLogger(pluginId: string): ScopedLogger {
  const prefix = `[plugin:${pluginId}]`
  return {
    debug: (message: string) => rootLogger.debug(`${prefix} ${message}`),
    system: (message: string) => rootLogger.system(`${prefix} ${message}`),
    warn: (message: string) => rootLogger.warn(`${prefix} ${message}`),
    error: (message: string) => rootLogger.error(`${prefix} ${message}`),
  }
}

function hasAccessibilityRequirement(metadata?: OpenMacPluginMetadata): boolean {
  const req = resolveRequestedPermissions(metadata)
  return req.includes('accessibility')
}

function resolveRequestedPermissions(metadata?: OpenMacPluginMetadata): PluginPermission[] {
  const raw = (metadata as any)?.permissions ?? (metadata as any)?.permissionsRequired ?? []
  const normalized = Array.isArray(raw) ? raw.map((p) => String(p).toLowerCase().trim()) : []

  // Allow older manifests to say "accessibility" but still get native bridge access.
  const out = new Set<PluginPermission>()
  for (const item of normalized) {
    if (item === 'accessibility') {
      out.add('accessibility')
      out.add('nativeBridge')
      continue
    }
    if (
      item === 'nativebridge' ||
      item === 'native_bridge' ||
      item === 'bridge' ||
      item === 'native-bridge'
    ) {
      out.add('nativeBridge')
      continue
    }
    if (item === 'sandbox') {
      out.add('sandbox')
      continue
    }
    if (item === 'screen_capture' || item === 'screencapture' || item === 'screen-capture') {
      out.add('screen_capture')
      continue
    }
    if (item === 'tools.register' || item === 'registertool' || item === 'register_tool') {
      out.add('tools.register')
      continue
    }
    if (item === 'filesystem.read') out.add('filesystem.read')
    if (item === 'filesystem.write') out.add('filesystem.write')
    if (item === 'automation') out.add('automation')
  }

  return Array.from(out.values())
}

async function isSwiftBridgeActive(): Promise<boolean> {
  // "Active" means the Swift bridge process is running and can accept events/requests.
  // Do NOT probe AX APIs here (that can be slow and may throw during boot/tests).
  return nativeBridge.isActive()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    ;(timer as any).unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function resolvePluginsRoot(): string {
  // Prefer compiled plugins when available (instant startup / no TS runtime).
  const distPlugins = path.join(process.cwd(), 'dist', 'plugins')
  if (fs.existsSync(distPlugins)) {
    return distPlugins
  }

  // Dev fallback.
  return path.join(process.cwd(), 'src', 'plugins')
}

function resolvePluginEntry(rootDir: string): string | null {
  // Support both TS and JS for local/dev vs compiled environments.
  const tsEntry = path.join(rootDir, 'index.ts')
  const jsEntry = path.join(rootDir, 'index.js')
  if (fs.existsSync(jsEntry)) return jsEntry
  if (fs.existsSync(tsEntry)) return tsEntry
  return null
}

function loadManifestFile(rootDir: string, pluginId: string): OpenMacPluginMetadata | null {
  const manifestPath = path.join(rootDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<OpenMacPluginMetadata>
    // Best-effort normalization; permission enforcement happens later.
    return {
      name: String(parsed.name ?? pluginId),
      version: String(parsed.version ?? '0.0.0'),
      permissions: Array.isArray((parsed as any).permissions) ? (parsed as any).permissions : [],
      permissionsRequired: Array.isArray((parsed as any).permissionsRequired)
        ? (parsed as any).permissionsRequired
        : undefined,
      tools: Array.isArray((parsed as any).tools) ? (parsed as any).tools : undefined,
    }
  } catch {
    return null
  }
}

function discoverPluginFolders(): DiscoveredPlugin[] {
  const pluginsRoot = resolvePluginsRoot()
  if (!fs.existsSync(pluginsRoot)) {
    return []
  }

  const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  const discovered: DiscoveredPlugin[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pluginDir = path.join(pluginsRoot, entry.name)
    const entryPath = resolvePluginEntry(pluginDir)
    if (!entryPath) continue
    discovered.push({ id: entry.name, rootDir: pluginDir, entryPath })
  }

  return discovered
}

export class PluginLoader {
  private readonly sandbox = new MacSandbox()
  private readonly loaded: Array<{
    id: string
    worker: PluginWorker
    manifest: OpenMacPluginMetadata | null
  }> = []
  private subscribedToBridgeEvents = false
  private readonly energyScores = new Map<string, PluginEnergyScore>()
  private readonly cpuTimeMsByPluginId = new Map<string, number>()
  private readonly slowEventStreakByPluginId = new Map<string, number>()
  private readonly slowRecommendationShown = new Set<string>()
  private readonly registeredToolNames = new Set<string>()

  getLoadedPlugins(): Array<{ id: string }> {
    return [...this.loaded]
  }

  getCpuTimeMsByPluginId(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [id, ms] of this.cpuTimeMsByPluginId.entries()) {
      out[id] = ms
    }
    return out
  }

  private ensureBridgeSubscription(): void {
    if (this.subscribedToBridgeEvents) return
    this.subscribedToBridgeEvents = true

    nativeBridge.onSystemEvent((event: SystemEvent) => {
      void this.broadcastEvent(event)
    })
  }

  private async broadcastEvent(event: SystemEvent): Promise<void> {
    const tasks = this.loaded.map(async (entry) => {
      const log = makeScopedLogger(entry.id)
      const startedAt = performance.now()
      let ok = true
      let errorMessage: string | null = null
      try {
        // Worker isolation: plugin code runs off-thread.
        // NOTE: Worker threads still share the same OS process; for true env isolation, prefer child_process.
        await withTimeout(entry.worker.onEvent(event), 2_000, `plugin '${entry.id}' onEvent(${event.type})`)
      } catch (error: any) {
        ok = false
        errorMessage = error?.message ?? String(error)
      } finally {
        const elapsedMs = performance.now() - startedAt
        const elapsedRounded = Math.round(elapsedMs)

        const score = this.energyScores.get(entry.id)
        if (score) {
          score.totalMs += elapsedRounded
          score.eventMs += elapsedRounded
          score.lastEventMs = elapsedRounded
          score.lastEventType = event.type
        }

        const total = (this.cpuTimeMsByPluginId.get(entry.id) ?? 0) + elapsedRounded
        this.cpuTimeMsByPluginId.set(entry.id, total)

        // Back-compat metric (kept for existing dashboards/logs).
        recordEnergyImpact('plugin_ms', elapsedRounded)

        // Self-healing: if plugin is consistently slow, recommend user action.
        const slow = elapsedRounded > 200
        const streak = slow ? (this.slowEventStreakByPluginId.get(entry.id) ?? 0) + 1 : 0
        this.slowEventStreakByPluginId.set(entry.id, streak)
        if (streak >= 3 && !this.slowRecommendationShown.has(entry.id)) {
          this.slowRecommendationShown.add(entry.id)
          log.warn(
            `Recommendation: "${entry.id}" is consistently slow (>200ms) handling events. Consider disabling the plugin or checking for updates.`,
          )
        }

        if (!ok) {
          log.warn(`onEvent(${event.type}) failed: ${errorMessage}`)
        } else if (event.type === 'WINDOW_FOCUS' && elapsedRounded > 100) {
          log.warn(`Heavy Plugin: onEvent(${event.type}) took ${elapsedRounded}ms (cpuTimeMs=${total})`)
        } else if (elapsedRounded >= 500) {
          log.warn(`onEvent(${event.type}) took ${elapsedRounded}ms`)
        } else {
          log.debug(`onEvent(${event.type}) took ${elapsedRounded}ms`)
        }
      }
    })

    await Promise.allSettled(tasks)
  }

  private async loadPlugin(
    candidate: DiscoveredPlugin,
  ): Promise<{ worker: PluginWorker; manifest: OpenMacPluginMetadata | null; bootMs: number } | null> {
    const log = makeScopedLogger(candidate.id)
    const manifest = loadManifestFile(candidate.rootDir, candidate.id)

    const requested = resolveRequestedPermissions(manifest ?? undefined)
    if (requested.includes('accessibility')) {
      const ok = await isSwiftBridgeActive()
      if (!ok) {
        log.warn(
          `Missing Host Permission: plugin requires accessibility but Swift bridge is not active. Refusing to load.`,
        )
        return null
      }
    }

    const startedAt = performance.now()
    const worker = new PluginWorker({
      pluginId: candidate.id,
      pluginPath: candidate.entryPath,
      manifest,
      config: {},
    })
    await worker.ready()
    const bootMs = Math.round(performance.now() - startedAt)

    // PluginLoader remains source-of-truth for timing aggregation.
    const energyScore = this.energyScores.get(candidate.id) ?? { totalMs: 0, loadMs: 0, eventMs: 0 }
    this.energyScores.set(candidate.id, energyScore)
    energyScore.totalMs += bootMs
    energyScore.loadMs += bootMs
    energyScore.lastLoadMs = bootMs

    const totalCpu = (this.cpuTimeMsByPluginId.get(candidate.id) ?? 0) + bootMs
    this.cpuTimeMsByPluginId.set(candidate.id, totalCpu)
    recordEnergyImpact('plugin_ms', bootMs)

    if (bootMs > 50) {
      log.warn(`Heavy Plugin: onLoad took ${bootMs}ms (cpuTimeMs=${totalCpu})`)
    } else {
      log.debug(`onLoad took ${bootMs}ms`)
    }

    return { worker, manifest, bootMs }
  }

  private registerManifestTools(
    pluginId: string,
    manifest: OpenMacPluginMetadata | null,
    worker: PluginWorker,
  ) {
    const tools = manifest?.tools ?? []
    for (const tool of tools) {
      const baseName = String((tool as any)?.name ?? '').trim()
      const description = String((tool as any)?.description ?? '').trim()
      const parametersJsonSchema = (tool as any)?.parametersJsonSchema
      if (!baseName || !description || !parametersJsonSchema) {
        continue
      }

      // Bind tool names to plugin id to avoid collisions.
      const name = `${pluginId}.${baseName}`
      if (this.registeredToolNames.has(name)) {
        continue
      }

      toolRegistry.register({
        name,
        description,
        // We validate in-worker; host accepts unknown args.
        parameters: z.object({}).passthrough(),
        parametersJsonSchema,
        execute: async (args: any) => {
          return await worker.callTool(baseName, args)
        },
      })
      this.registeredToolNames.add(name)
    }
  }

  async discoverAndLoadAll(): Promise<void> {
    this.ensureBridgeSubscription()

    const discovered = discoverPluginFolders()
    if (discovered.length === 0) {
      return
    }

    let pluginOverheadMs = 0
    for (const candidate of discovered) {
      const log = makeScopedLogger(candidate.id)
      try {
        const loaded = await this.loadPlugin(candidate)
        if (!loaded) {
          continue
        }

        pluginOverheadMs += loaded.bootMs
        this.loaded.push({ id: candidate.id, worker: loaded.worker, manifest: loaded.manifest })
        this.registerManifestTools(candidate.id, loaded.manifest, loaded.worker)
        log.system(
          `Loaded (${loaded.manifest?.name ?? candidate.id} v${loaded.manifest?.version ?? '0.0.0'}).`,
        )
      } catch (error: any) {
        log.error(`Failed to load: ${error?.message ?? String(error)}`)
        // Isolation requirement: continue booting other plugins.
        continue
      }
    }

    rootLogger.system(
      `[plugins] Plugin Overhead: ${pluginOverheadMs}ms across ${this.loaded.length} plugin(s)`,
    )
  }
}
