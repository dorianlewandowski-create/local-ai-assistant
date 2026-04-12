// JS worker entry to keep memory low under 128MB resource limits.
// Source of truth remains workerEntry.ts; this file mirrors its runtime behavior.

const { parentPort } = require('worker_threads')
const { pathToFileURL } = require('url')

if (!parentPort) {
  throw new Error('workerEntry must be run in a worker thread (parentPort is null)')
}

// Best-effort isolation: never allow plugins to read the host environment by default.
process.env = {}

const port = parentPort

let pluginId = null
let plugin = null
let context = null

let rpcSeq = 0
const pendingRpc = new Map() // id -> { resolve, reject }

function rpcRequest(capability, method, args) {
  const id = `${Date.now()}-${++rpcSeq}`
  const msg = { type: 'rpcRequest', id, capability, method, args: args || [] }
  const promise = new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject })
  })
  port.postMessage(msg)
  return promise
}

function buildProxyContext(init) {
  const energyScore = { totalMs: 0, loadMs: 0, eventMs: 0 }
  const logger = {
    debug: (message) => port.postMessage({ type: 'log', level: 'debug', pluginId: init.pluginId, message }),
    system: (message) => port.postMessage({ type: 'log', level: 'system', pluginId: init.pluginId, message }),
    warn: (message) => port.postMessage({ type: 'log', level: 'warn', pluginId: init.pluginId, message }),
    error: (message) => port.postMessage({ type: 'log', level: 'error', pluginId: init.pluginId, message }),
  }

  const bridge = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        return (...args) => rpcRequest('bridge', prop, args)
      },
    },
  )

  return {
    logger,
    manifest: init.manifest || null,
    config: init.config || {},
    energyScore,
    energy: {
      reportUsage: (ms) => {
        rpcRequest('energy', 'reportUsage', [ms]).catch(() => undefined)
      },
    },
    bridge,
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
}

async function loadPluginModule(pluginPath) {
  const specifier = pluginPath && pluginPath.startsWith('/') ? pathToFileURL(pluginPath).href : pluginPath
  const mod = await import(specifier)
  const candidate = mod && (mod.default || mod.plugin) ? mod.default || mod.plugin : mod
  return candidate && (candidate.default || candidate.plugin)
    ? candidate.default || candidate.plugin
    : candidate
}

function instantiate(Loaded) {
  const instance = typeof Loaded === 'function' ? new Loaded() : Loaded
  const hasHooks =
    instance &&
    typeof instance.onLoad === 'function' &&
    typeof instance.onUnload === 'function' &&
    typeof instance.onEvent === 'function'
  if (!hasHooks) {
    throw new Error('Plugin export must implement OpenMacPlugin lifecycle hooks (onLoad/onUnload/onEvent).')
  }
  return instance
}

async function handleInit(msg) {
  pluginId = msg.pluginId
  context = buildProxyContext(msg)
  const Loaded = await loadPluginModule(msg.pluginPath)
  plugin = instantiate(Loaded)
  await plugin.onLoad(context)
  port.postMessage({ type: 'ready', pluginId: msg.pluginId })
}

async function handleOnEvent(msg) {
  if (!plugin || !context || !pluginId) {
    throw new Error('Worker is not initialized. Did you forget to send {type:"init"}?')
  }
  await plugin.onEvent(msg.event)
  port.postMessage({ type: 'eventDone', id: msg.id })
}

async function handleUnload() {
  if (plugin) await plugin.onUnload()
  plugin = null
  context = null
  pluginId = null
  port.postMessage({ type: 'unloaded' })
}

function toErrorMessage(error) {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

port.on('message', (raw) => {
  Promise.resolve()
    .then(async () => {
      if (raw && raw.type === 'rpcResponse') {
        const entry = pendingRpc.get(raw.id)
        if (!entry) return
        pendingRpc.delete(raw.id)
        if (raw.ok) entry.resolve(raw.result)
        else entry.reject(new Error((raw.error && raw.error.message) || 'RPC failed'))
        return
      }

      if (!raw || typeof raw !== 'object') return
      if (raw.type === 'heartbeat') {
        port.postMessage({ type: 'heartbeatAck', atMs: Date.now() })
        return
      }
      if (raw.type === 'init') return handleInit(raw)
      if (raw.type === 'onEvent') return handleOnEvent(raw)
      if (raw.type === 'unload') return handleUnload()
    })
    .catch((error) => {
      port.postMessage({ type: 'workerError', pluginId, message: toErrorMessage(error) })
    })
})
