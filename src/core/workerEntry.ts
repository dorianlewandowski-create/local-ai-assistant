import { parentPort } from 'worker_threads'
import { pathToFileURL } from 'url'
import type {
  OpenMacPlugin,
  OpenMacPluginMetadata,
  PluginContext,
  PluginEnergyScore,
  SystemEvent,
} from '../sdk/types'

// Best-effort isolation: never allow plugins to read the host environment by default.
// NOTE: Worker threads are not a full security boundary; for stronger isolation use child_process.
process.env = {}

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

type WorkerInboundMessage =
  | WorkerInitMessage
  | WorkerOnEventMessage
  | WorkerCallToolMessage
  | WorkerUnloadMessage
  | WorkerHeartbeatMessage
  | RpcResponseMessage

type RpcRequestMessage = {
  type: 'rpcRequest'
  id: string
  capability: 'bridge' | 'energy'
  method: string
  args: unknown[]
}

type RpcOkResponseMessage = {
  type: 'rpcResponse'
  id: string
  ok: true
  result: unknown
}

type RpcErrorResponseMessage = {
  type: 'rpcResponse'
  id: string
  ok: false
  error: { message: string }
}

type RpcResponseMessage = RpcOkResponseMessage | RpcErrorResponseMessage

function invariantPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error('workerEntry must be run in a worker thread (parentPort is null)')
  }
  return parentPort
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const port = invariantPort()

let pluginId: string | null = null
let plugin: OpenMacPlugin<any> | null = null
let context: PluginContext<any> | null = null

let rpcSeq = 0
const pendingRpc = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }
>()

function rpcRequest<T = unknown>(
  capability: RpcRequestMessage['capability'],
  method: string,
  args: unknown[] = [],
): Promise<T> {
  const id = `${Date.now()}-${++rpcSeq}`
  const msg: RpcRequestMessage = { type: 'rpcRequest', id, capability, method, args }
  const promise = new Promise<T>((resolve, reject) => {
    pendingRpc.set(id, { resolve: resolve as any, reject })
  })
  port.postMessage(msg)
  return promise
}

function buildProxyContext(init: WorkerInitMessage): PluginContext<any> {
  const energyScore: PluginEnergyScore = { totalMs: 0, loadMs: 0, eventMs: 0 }

  const logger = {
    debug: (message: string) =>
      port.postMessage({ type: 'log', level: 'debug', pluginId: init.pluginId, message }),
    system: (message: string) =>
      port.postMessage({ type: 'log', level: 'system', pluginId: init.pluginId, message }),
    warn: (message: string) =>
      port.postMessage({ type: 'log', level: 'warn', pluginId: init.pluginId, message }),
    error: (message: string) =>
      port.postMessage({ type: 'log', level: 'error', pluginId: init.pluginId, message }),
  }

  // Bridge proxy: any method call becomes an RPC to the main thread.
  // Explicitly include "click" (requested) but allow arbitrary bridge methods too.
  const bridge = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        return (...args: unknown[]) => rpcRequest('bridge', prop, args)
      },
    },
  ) as any

  const ctx: PluginContext<any> = {
    logger,
    manifest: init.manifest,
    config: init.config ?? {},
    energyScore,
    energy: {
      reportUsage: (ms: number) => {
        void rpcRequest('energy', 'reportUsage', [ms]).catch(() => undefined)
      },
    },
    bridge,
    // Sandbox + tool registry are intentionally not exposed in the worker context by default.
    sandbox: undefined,
    registerTool: undefined,
    requireBridge: () => bridge,
    requireSandbox: () => {
      throw new Error(
        `[Permission Denied] Plugin "${init.pluginId}" attempted to use "sandbox" in worker context.`,
      )
    },
    requireRegisterTool: () => {
      throw new Error(
        `[Permission Denied] Plugin "${init.pluginId}" attempted to use "registerTool" in worker context.`,
      )
    },
  }

  return ctx
}

async function loadPluginModule(pluginPath: string): Promise<any> {
  // Dynamic import (requested). Allow either a default export, named `plugin`, or module itself.
  const specifier = pluginPath.startsWith('/') ? pathToFileURL(pluginPath).href : pluginPath
  const mod = await import(specifier)
  // When importing CommonJS via `import()`, Node wraps `module.exports` as `mod.default`.
  // esbuild emits `module.exports = { __esModule: true, default: ... }`, so we unwrap that too.
  const candidate = mod?.default ?? mod?.plugin ?? mod
  return candidate?.default ?? candidate?.plugin ?? candidate
}

function instantiate(Loaded: any): OpenMacPlugin<any> {
  const instance = typeof Loaded === 'function' ? new Loaded() : Loaded
  const hasHooks =
    instance &&
    typeof instance.onLoad === 'function' &&
    typeof instance.onUnload === 'function' &&
    typeof instance.onEvent === 'function'
  if (!hasHooks) {
    throw new Error(`Plugin export must implement OpenMacPlugin lifecycle hooks (onLoad/onUnload/onEvent).`)
  }
  return instance as OpenMacPlugin<any>
}

async function handleInit(msg: WorkerInitMessage): Promise<void> {
  pluginId = msg.pluginId
  context = buildProxyContext(msg)

  const Loaded = await loadPluginModule(msg.pluginPath)
  plugin = instantiate(Loaded)

  await plugin.onLoad(context)
  port.postMessage({ type: 'ready', pluginId: msg.pluginId })
}

async function handleOnEvent(msg: WorkerOnEventMessage): Promise<void> {
  if (!plugin || !context || !pluginId) {
    throw new Error('Worker is not initialized. Did you forget to send {type:"init"}?')
  }
  await plugin.onEvent(msg.event)
  port.postMessage({ type: 'eventDone', id: msg.id })
}

async function handleCallTool(msg: WorkerCallToolMessage): Promise<void> {
  if (!plugin || !context || !pluginId) {
    throw new Error('Worker is not initialized. Did you forget to send {type:"init"}?')
  }
  if (typeof plugin.callTool !== 'function') {
    port.postMessage({
      type: 'toolResult',
      id: msg.id,
      ok: false,
      error: { message: `Plugin does not implement callTool()` },
    })
    return
  }
  try {
    const result = await plugin.callTool(msg.toolName, msg.args)
    port.postMessage({ type: 'toolResult', id: msg.id, ok: true, result })
  } catch (error: any) {
    port.postMessage({ type: 'toolResult', id: msg.id, ok: false, error: { message: toErrorMessage(error) } })
  }
}

async function handleUnload(): Promise<void> {
  if (plugin) {
    await plugin.onUnload()
  }
  plugin = null
  context = null
  pluginId = null
  port.postMessage({ type: 'unloaded' })
}

port.on('message', (raw: WorkerInboundMessage) => {
  void (async () => {
    // RPC responses
    if (raw && (raw as any).type === 'rpcResponse') {
      const msg = raw as RpcResponseMessage
      const entry = pendingRpc.get(msg.id)
      if (!entry) return
      pendingRpc.delete(msg.id)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new Error(msg.error?.message ?? 'RPC failed'))
      return
    }

    // Lifecycle / events
    if (!raw || typeof raw !== 'object') return
    if (raw.type === 'heartbeat') {
      port.postMessage({ type: 'heartbeatAck', atMs: Date.now() })
      return
    }
    if (raw.type === 'init') {
      await handleInit(raw)
      return
    }
    if (raw.type === 'onEvent') {
      await handleOnEvent(raw)
      return
    }
    if (raw.type === 'callTool') {
      await handleCallTool(raw)
      return
    }
    if (raw.type === 'unload') {
      await handleUnload()
      return
    }
  })().catch((error) => {
    port.postMessage({
      type: 'workerError',
      pluginId,
      message: toErrorMessage(error),
    })
  })
})
