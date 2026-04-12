import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import type { SystemEvent } from '@apex/types'
import { resolveApexInstallRoot } from './installRoot'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface NativeBridgeError {
  message: string
  systemHint?: string
  code?: number
  kind?: string
}

interface NativeBridgeResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: NativeBridgeError
}

type NativeBridgeEventEnvelope = {
  event: SystemEvent
}

interface NativeBridgeRequest {
  id: string
  method: 'ax.uiTree' | 'screen.capturePng' | 'menuBar.updateStatus' | 'menuBar.configureBrainSelector'
  params?: Record<string, unknown>
}

export interface NativeUiTreeOptions {
  maxDepth?: number
  maxNodes?: number
}

export interface NativeUiTreeResult {
  appName: string
  capturedAtMs: number
  root: unknown
  limits: { maxDepth: number; maxNodes: number }
}

export interface NativeScreenshotOptions {
  displayIndex?: number
  maxWidth?: number
  maxHeight?: number
}

export interface NativeScreenshotResult {
  pngBase64: string
  pngBuffer: Buffer
}

function nowMs() {
  return Date.now()
}

function withJitter(valueMs: number, jitterRatio = 0.2) {
  const jitter = valueMs * jitterRatio
  const delta = (Math.random() * 2 - 1) * jitter
  return Math.max(0, Math.round(valueMs + delta))
}

export { resolveApexInstallRoot } from './installRoot'

export function resolveNativeBridgePath(): string {
  return path.join(
    resolveApexInstallRoot(),
    'nodes',
    'macos',
    'claw-native-bridge',
    '.build',
    'release',
    'claw-native-bridge',
  )
}

export class NativeBridge extends EventEmitter {
  private readonly systemEventEmitter = new EventEmitter()
  private child: ChildProcessWithoutNullStreams | null = null
  private rl: readline.Interface | null = null
  private readonly pending = new Map<
    string,
    {
      deferred: Deferred<NativeBridgeResponse>
      timeout: NodeJS.Timeout
    }
  >()

  private started = false
  private stopping = false
  private restartTimer: NodeJS.Timeout | null = null
  private restartAttempt = 0
  private readonly requestTimeoutMs = 30_000

  constructor() {
    super()
    this.start()
  }

  onSystemEvent(handler: (event: SystemEvent) => void): () => void {
    this.systemEventEmitter.on('systemEvent', handler)
    return () => this.systemEventEmitter.off('systemEvent', handler)
  }

  isActive(): boolean {
    return Boolean(this.child && !this.child.killed)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.attachExitHandlersOnce()
    this.spawnBridge()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.rejectAllPending(new Error('Native bridge stopped.'))
    await this.killChild()
  }

  async send<T = unknown>(
    method: NativeBridgeRequest['method'],
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.start()
    await this.waitForReady()

    const id = `${nowMs()}-${Math.random().toString(36).slice(2, 10)}`
    const payload: NativeBridgeRequest = { id, method, params }

    const deferred = createDeferred<NativeBridgeResponse>()
    const timeout = setTimeout(() => {
      this.pending.delete(id)
      deferred.reject(new Error(`Native bridge request timed out (${method})`))
    }, this.requestTimeoutMs)

    this.pending.set(id, { deferred, timeout })

    try {
      this.child!.stdin.write(JSON.stringify(payload) + '\n')
    } catch (error: any) {
      clearTimeout(timeout)
      this.pending.delete(id)
      const err = error instanceof Error ? error : new Error(String(error))
      const code = (error as any)?.code
      if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
        this.rejectAllPending(err)
        this.scheduleRestart()
      }
      throw err
    }

    const response = await deferred.promise
    if (!response.ok) {
      const message = response.error?.message || 'Native bridge error'
      const hint = response.error?.systemHint
      const code = response.error?.code
      const kind = response.error?.kind
      const err = new Error(hint ? `${message}\n\n${hint}` : message)
      ;(err as any).nativeBridge = { systemHint: hint, code, kind }
      throw err
    }

    return response.result as T
  }

  async getUiTree(maxDepth = 10, maxNodes = 1200): Promise<NativeUiTreeResult> {
    const result = await this.send<string>('ax.uiTree', { maxDepth, maxNodes })
    return JSON.parse(result) as NativeUiTreeResult
  }

  async captureScreen(options: NativeScreenshotOptions = {}): Promise<NativeScreenshotResult> {
    const pngBase64 = await this.send<string>('screen.capturePng', {
      displayIndex: options.displayIndex ?? 0,
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
    })
    return { pngBase64, pngBuffer: Buffer.from(pngBase64, 'base64') }
  }

  async updateMenuBarStatus(options: { statusText: string; blink?: boolean }): Promise<void> {
    await this.send('menuBar.updateStatus', {
      statusText: options.statusText,
      blink: options.blink ?? false,
    })
  }

  async configureBrainSelector(options: {
    activeBrain: 'local' | 'gemini'
    routerMode?: 'always_gemini' | 'always_local' | 'smart'
    recommendLocal?: boolean
    title?: string
  }): Promise<void> {
    await this.send('menuBar.configureBrainSelector', {
      activeBrain: options.activeBrain,
      routerMode: options.routerMode,
      recommendLocal: options.recommendLocal ?? false,
      title: options.title,
    })
  }

  private async waitForReady(): Promise<void> {
    if (this.child && !this.child.killed) return
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    if (!this.child || this.child.killed) {
      throw new Error('Native bridge is not available.')
    }
  }

  private spawnBridge(): void {
    if (this.stopping) return

    const executablePath = resolveNativeBridgePath()
    if (!fs.existsSync(executablePath)) {
      const error = new Error(
        [
          'Native bridge binary is missing.',
          `Expected: ${executablePath}`,
          '',
          'Build it with:',
          '  bash scripts/build-native.sh',
        ].join('\n'),
      )
      this.emit('error', error)
      this.rejectAllPending(error)
      return
    }

    this.child = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.emit('started', { pid: this.child.pid, path: executablePath })

    this.child.on('exit', (code, signal) => {
      this.child = null
      this.teardownReadline()
      this.rejectAllPending(
        new Error(`Native bridge exited (code=${code ?? 'null'} signal=${signal ?? 'null'}).`),
      )
      this.emit('exit', { code, signal })
      this.scheduleRestart()
    })

    this.child.on('error', (error) => {
      this.child = null
      this.teardownReadline()
      this.rejectAllPending(error)
      this.emit('error', error)
      this.scheduleRestart()
    })

    this.child.stderr.on('data', () => {
      // keep stderr flowing
    })

    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on('line', (line) => this.handleLine(line))
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let parsed: NativeBridgeResponse | NativeBridgeEventEnvelope
    try {
      parsed = JSON.parse(trimmed) as NativeBridgeResponse | NativeBridgeEventEnvelope
    } catch {
      return
    }

    const maybeEvent = (parsed as NativeBridgeEventEnvelope)?.event
    if (maybeEvent && typeof maybeEvent.type === 'string') {
      this.systemEventEmitter.emit('systemEvent', maybeEvent)
      return
    }

    const response = parsed as NativeBridgeResponse
    if (!response?.id) return
    const entry = this.pending.get(response.id)
    if (!entry) return

    clearTimeout(entry.timeout)
    this.pending.delete(response.id)
    entry.deferred.resolve(response)
  }

  private scheduleRestart(): void {
    if (this.stopping) return
    if (this.restartTimer) return

    this.restartAttempt += 1
    const baseDelay = Math.min(10_000, 200 * Math.pow(2, Math.min(this.restartAttempt, 6)))
    const delay = withJitter(baseDelay)

    this.emit('restarting', { attempt: this.restartAttempt, delayMs: delay })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnBridge()
    }, delay)
  }

  private rejectAllPending(error: Error): void {
    for (const { deferred, timeout } of this.pending.values()) {
      clearTimeout(timeout)
      deferred.reject(error)
    }
    this.pending.clear()
  }

  private teardownReadline(): void {
    if (this.rl) {
      this.rl.removeAllListeners()
      this.rl.close()
      this.rl = null
    }
  }

  private async killChild(): Promise<void> {
    const child = this.child
    this.child = null
    this.teardownReadline()
    if (!child) return

    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    if (!child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }

  private attachExitHandlersOnce(): void {
    const shutdown = () => {
      void this.stop()
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('exit', shutdown)
  }
}

export const nativeBridge = new NativeBridge()

export async function getNativeUiTree(options: NativeUiTreeOptions = {}): Promise<NativeUiTreeResult> {
  return nativeBridge.getUiTree(options.maxDepth ?? 10, options.maxNodes ?? 1200)
}

export async function getNativeScreenshot(
  options: NativeScreenshotOptions = {},
): Promise<NativeScreenshotResult> {
  return nativeBridge.captureScreen(options)
}
