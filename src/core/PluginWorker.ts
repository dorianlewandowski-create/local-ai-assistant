import path from 'path'
import { Worker } from 'worker_threads'
import { logger } from '../utils/logger'
import { nativeBridge } from '@apex/macos-node'
import type { OpenMacPluginMetadata, PluginPermission, SystemEvent } from '../sdk/types'

const TOKYO_NIGHT = {
  apex: { r: 125, g: 207, b: 255 }, // #7dcfff
  storm: { r: 86, g: 95, b: 137 }, // #565f89
}

function rgb({ r, g, b }: { r: number; g: number; b: number }, text: string) {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

type WorkerInitMessage = {
  type: 'init'
  pluginPath: string
  pluginId: string
  manifest: OpenMacPluginMetadata | null
  config?: unknown
}

type WorkerOnEventMessage = {
  type: 'onEvent'
  id: string
  event: SystemEvent
}

type WorkerCallToolMessage = {
  type: 'callTool'
  id: string
  toolName: string
  args: unknown
}

type WorkerUnloadMessage = {
  type: 'unload'
}

type WorkerHeartbeatMessage = {
  type: 'heartbeat'
}

type RpcRequestMessage = {
  type: 'rpcRequest'
  id: string
  capability: 'bridge' | 'energy'
  method: string
  args: unknown[]
}

type RpcResponseMessage =
  | { type: 'rpcResponse'; id: string; ok: true; result: unknown }
  | { type: 'rpcResponse'; id: string; ok: false; error: { message: string } }

type WorkerOutboundMessage =
  | RpcRequestMessage
  | { type: 'log'; level: 'debug' | 'system' | 'warn' | 'error'; pluginId: string; message: string }
  | { type: 'ready'; pluginId: string }
  | { type: 'eventDone'; id: string }
  | { type: 'toolResult'; id: string; ok: true; result: unknown }
  | { type: 'toolResult'; id: string; ok: false; error: { message: string } }
  | { type: 'unloaded' }
  | { type: 'workerError'; pluginId: string | null; message: string }
  | { type: 'heartbeatAck'; atMs: number }

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizePermissions(manifest: OpenMacPluginMetadata | null): Set<PluginPermission> {
  const raw = (manifest as any)?.permissions ?? (manifest as any)?.permissionsRequired ?? []
  const normalized = Array.isArray(raw) ? raw.map((p: any) => String(p).toLowerCase().trim()) : []
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
    if (item === 'screen_capture' || item === 'screencapture' || item === 'screen-capture') {
      out.add('screen_capture')
      continue
    }
    if (item === 'sandbox' || item === 'untrustedexecution') out.add('sandbox')
    if (item === 'tools.register' || item === 'registertool' || item === 'register_tool')
      out.add('tools.register')
    if (item === 'filesystem.read') out.add('filesystem.read')
    if (item === 'filesystem.write') out.add('filesystem.write')
    if (item === 'automation') out.add('automation')
  }
  return out
}

export class PluginWorker {
  private readonly pluginId: string
  private readonly pluginPath: string
  private readonly manifest: OpenMacPluginMetadata | null
  private readonly permissions: Set<PluginPermission>
  private readonly initConfig?: unknown

  private workerPromise: Promise<Worker> | null = null
  private workerRef: Worker | null = null

  private idleTimer: NodeJS.Timeout | null = null

  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatDeadline: NodeJS.Timeout | null = null
  private lastHeartbeatAckAtMs: number | null = null

  private readyResolve: (() => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  private readyPromise: Promise<void> | null = null

  private eventSeq = 0
  private readonly pendingEvents = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  private toolSeq = 0
  private readonly pendingTools = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()

  constructor(options: {
    pluginId: string
    pluginPath: string
    manifest: OpenMacPluginMetadata | null
    config?: unknown
  }) {
    this.pluginId = options.pluginId
    this.pluginPath = options.pluginPath
    this.manifest = options.manifest
    this.initConfig = options.config
    this.permissions = normalizePermissions(options.manifest)
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    this.idleTimer = setTimeout(() => {
      void (async () => {
        const worker = this.workerRef
        if (!worker) {
          return
        }
        logger.system(rgb(TOKYO_NIGHT.storm, `[Apex] Sleeping worker "${this.pluginId}" to save energy.`))
        this.stopHeartbeat()
        await worker.terminate().catch(() => undefined)
        this.workerRef = null
        this.workerPromise = null
        this.readyPromise = null
      })()
    }, 300_000)
    ;(this.idleTimer as any).unref?.()
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.workerPromise) {
      return this.workerPromise
    }

    this.workerPromise = (async () => {
      logger.system(rgb(TOKYO_NIGHT.apex, `[Apex] Spawning worker for "${this.pluginId}"...`))

      // In dev/tests we keep the lightweight JS worker entry under src/ (no TS runtime needed).
      // In production builds we prefer the compiled dist worker entry.
      const distEntry = path.join(process.cwd(), 'dist', 'core', 'workerEntry.js')
      const devEntry = path.join(process.cwd(), 'src', 'core', 'workerEntry.js')
      const entryPath = require('fs').existsSync(distEntry) ? distEntry : devEntry
      const worker = new Worker(entryPath, {
        // Plugin workers may load TS (ts-node) in dev/tests; keep enough heap headroom.
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      })

      this.workerRef = worker
      this.lastHeartbeatAckAtMs = null

      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve
        this.readyReject = reject
      })

      worker.on('message', (msg: WorkerOutboundMessage) => {
        void this.onWorkerMessage(msg)
      })

      worker.on('error', (err) => {
        this.crash(`Worker error: ${err.message}`)
        this.readyReject?.(err)
      })

      worker.on('exit', (code) => {
        // Reset state so future calls can respawn.
        this.stopHeartbeat()
        this.workerRef = null
        this.workerPromise = null
        this.readyPromise = null

        if (code !== 0) {
          this.crash(`Worker exited with code=${code}`)
          this.readyReject?.(new Error(`Worker exited (code=${code})`))
        }
      })

      const initMsg: WorkerInitMessage = {
        type: 'init',
        pluginPath: this.pluginPath,
        pluginId: this.pluginId,
        manifest: this.manifest,
        config: this.initConfig,
      }
      worker.postMessage(initMsg)

      this.startHeartbeat()
      this.resetIdleTimer()
      return worker
    })()

    return this.workerPromise
  }

  async ready(): Promise<void> {
    await this.ensureWorker()
    if (!this.readyPromise) {
      throw new Error('Worker ready promise missing.')
    }
    return this.readyPromise
  }

  async onEvent(event: SystemEvent): Promise<void> {
    await this.ensureWorker()
    await this.ready()
    const id = `${Date.now()}-${++this.eventSeq}`
    const msg: WorkerOnEventMessage = { type: 'onEvent', id, event }
    const promise = new Promise<void>((resolve, reject) => {
      this.pendingEvents.set(id, { resolve, reject })
    })
    this.workerRef!.postMessage(msg)
    const result = await promise
    this.resetIdleTimer()
    return result
  }

  async callTool(toolName: string, args: unknown): Promise<unknown> {
    await this.ensureWorker()
    await this.ready()
    const id = `${Date.now()}-tool-${++this.toolSeq}`
    const msg: WorkerCallToolMessage = { type: 'callTool', id, toolName, args }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingTools.set(id, { resolve, reject })
    })
    this.workerRef!.postMessage(msg)
    const result = await promise
    this.resetIdleTimer()
    return result
  }

  async unload(): Promise<void> {
    const worker = this.workerRef
    if (!worker) {
      this.workerPromise = null
      this.readyPromise = null
      return
    }
    const msg: WorkerUnloadMessage = { type: 'unload' }
    worker.postMessage(msg)
    await worker.terminate().catch(() => undefined)
    this.workerRef = null
    this.workerPromise = null
    this.readyPromise = null
    this.stopHeartbeat()
  }

  private hasAny(...perms: PluginPermission[]): boolean {
    return perms.some((p) => this.permissions.has(p))
  }

  private async onWorkerMessage(msg: WorkerOutboundMessage): Promise<void> {
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'ready') {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }

    if (msg.type === 'heartbeatAck') {
      this.lastHeartbeatAckAtMs = msg.atMs
      if (this.heartbeatDeadline) {
        clearTimeout(this.heartbeatDeadline)
        this.heartbeatDeadline = null
      }
      return
    }

    if (msg.type === 'eventDone') {
      const pending = this.pendingEvents.get(msg.id)
      if (pending) {
        this.pendingEvents.delete(msg.id)
        pending.resolve()
      }
      return
    }

    if (msg.type === 'toolResult') {
      const pending = this.pendingTools.get(msg.id)
      if (!pending) {
        return
      }
      this.pendingTools.delete(msg.id)
      if (msg.ok) pending.resolve(msg.result)
      else pending.reject(new Error(msg.error?.message ?? 'Tool call failed'))
      return
    }

    if (msg.type === 'log') {
      const prefix = `[plugin:${msg.pluginId}]`
      const text = `${prefix} ${msg.message}`
      if (msg.level === 'debug') logger.debug(text)
      else if (msg.level === 'system') logger.system(text)
      else if (msg.level === 'warn') logger.warn(text)
      else logger.error(text)
      return
    }

    if (msg.type === 'workerError') {
      this.crash(`WorkerError: ${msg.message}`)
      for (const p of this.pendingEvents.values()) {
        p.reject(new Error(msg.message))
      }
      this.pendingEvents.clear()
      for (const p of this.pendingTools.values()) {
        p.reject(new Error(msg.message))
      }
      this.pendingTools.clear()
      return
    }

    if (msg.type === 'rpcRequest') {
      await this.handleRpcRequest(msg)
    }
  }

  private async handleRpcRequest(req: RpcRequestMessage): Promise<void> {
    try {
      if (req.capability === 'energy') {
        if (req.method === 'reportUsage') {
          // Main thread is source-of-truth for energy attribution; worker is just advisory.
          // You can wire this into your existing energy accounting if desired.
          return this.reply(req.id, true, { ok: true })
        }
        throw new Error(`Unknown energy method: ${req.method}`)
      }

      if (req.capability !== 'bridge') {
        throw new Error(`Unknown capability: ${req.capability}`)
      }

      // Permission gate: bridge access requires either accessibility or nativeBridge.
      if (!this.hasAny('accessibility', 'nativeBridge')) {
        throw new Error(
          `[Permission Denied] Plugin "${this.pluginId}" attempted to call bridge.${req.method}() without nativeBridge/accessibility permission.`,
        )
      }

      // Extra gate: screen capture requires explicit screen_capture permission.
      if (req.method === 'captureScreen' && !this.permissions.has('screen_capture')) {
        throw new Error(
          `[Permission Denied] Plugin "${this.pluginId}" attempted to call bridge.captureScreen() without screen_capture permission.`,
        )
      }

      const fn = (nativeBridge as any)[req.method]
      if (typeof fn !== 'function') {
        throw new Error(`NativeBridge method not supported: ${req.method}`)
      }

      const result = await fn.apply(nativeBridge as any, req.args ?? [])
      this.reply(req.id, true, result)
    } catch (error) {
      this.reply(req.id, false, { message: toErrorMessage(error) })
    }
  }

  private reply(id: string, ok: true, result: unknown): void
  private reply(id: string, ok: false, error: { message: string }): void
  private reply(id: string, ok: boolean, payload: unknown): void {
    const msg: RpcResponseMessage = ok
      ? { type: 'rpcResponse', id, ok: true, result: payload }
      : { type: 'rpcResponse', id, ok: false, error: payload as any }
    this.workerRef?.postMessage(msg)
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    const send = () => {
      const worker = this.workerRef
      if (!worker) {
        return
      }
      const msg: WorkerHeartbeatMessage = { type: 'heartbeat' }
      worker.postMessage(msg)

      if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline)
      this.heartbeatDeadline = setTimeout(() => {
        this.crash('Plugin Crashed: heartbeat timeout (>5s)')
        void worker.terminate().catch(() => undefined)
      }, 5_000)
      ;(this.heartbeatDeadline as any).unref?.()
    }

    // Kick immediately and then periodically.
    send()
    this.heartbeatTimer = setInterval(send, 2_000)
    ;(this.heartbeatTimer as any).unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatDeadline) {
      clearTimeout(this.heartbeatDeadline)
      this.heartbeatDeadline = null
    }
  }

  private crash(reason: string): void {
    this.stopHeartbeat()
    for (const p of this.pendingEvents.values()) {
      p.reject(new Error(reason))
    }
    this.pendingEvents.clear()
    for (const p of this.pendingTools.values()) {
      p.reject(new Error(reason))
    }
    this.pendingTools.clear()
    logger.error(`[plugin:${this.pluginId}] ${reason}`)
  }
}
