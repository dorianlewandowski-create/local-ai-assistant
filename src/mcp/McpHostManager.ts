import { logger } from '../utils/logger'
import { recordEnergyImpact } from '../utils/energyImpact'
import { config, type McpServerConfig as ConfigMcpServerConfig } from '@apex/core'
import { nativeBridge } from '@apex/macos-node'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'

export type McpServerConfig = ConfigMcpServerConfig & {
  /**
   * Optional working directory for the spawned process.
   */
  cwd?: string
  /**
   * Optional connection timeout for MCP initialization.
   */
  startupTimeoutMs?: number
  /**
   * Optional request timeout for listTools/callTool.
   */
  requestTimeoutMs?: number
}

export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export type McpToolDescriptor = {
  serverId: string
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  title?: string
}

export type McpCallToolResult = {
  serverId: string
  toolName: string
  raw: unknown
}

type ServerHandle = {
  id: string
  config: McpServerConfig
  desiredRunning: boolean
  status: McpServerStatus
  lastError: string | null
  transport: StdioClientTransport | null
  client: Client | null
  pid: number | null
  stderrTail: string[]
  connectedAtMs: number | null
  lastActivityAtMs: number | null
  idleKillTimer: NodeJS.Timeout | null
  restartAttempts: number
  restartTimer: NodeJS.Timeout | null
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`)
      ;(err as any).code = 'ETIMEDOUT'
      reject(err)
    }, timeoutMs)
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export class McpHostManager {
  private readonly clientInfo: { name: string; version: string }
  private readonly servers: Map<string, ServerHandle> = new Map()
  private readonly idleKillMs = 10 * 60_000
  private toolInFlight = 0
  private lastMenuBarText: string | null = null
  private lastMenuBarBlink: boolean | null = null

  constructor(options?: { clientName?: string; clientVersion?: string }) {
    this.clientInfo = {
      name: options?.clientName ?? 'apex',
      version: options?.clientVersion ?? '0.0.0',
    }
  }

  private async updateNativeMenuBar(): Promise<void> {
    const active = Array.from(this.servers.values()).filter((s) => s.status === 'running').length
    const text = `Apex: ${active} MCP Server${active === 1 ? '' : 's'} Active`
    const blink = this.toolInFlight > 0

    // Avoid spamming the native bridge with redundant updates.
    if (this.lastMenuBarText === text && this.lastMenuBarBlink === blink) {
      return
    }
    this.lastMenuBarText = text
    this.lastMenuBarBlink = blink

    await nativeBridge.updateMenuBarStatus({ statusText: text, blink }).catch(() => undefined)
  }

  /**
   * Synchronize internal server list from `config.mcp` (populated asynchronously by
   * `@apex/core` from `config/mcpServers.json` — separate from `apex.json`).
   */
  syncFromConfig(): void {
    const nextIds = new Set<string>()
    const mcpServers = config.mcp ?? {}

    for (const [id, cfg] of Object.entries(mcpServers)) {
      nextIds.add(id)
      const normalized: McpServerConfig = {
        command: cfg.command,
        args: cfg.args ?? [],
        env: cfg.env ?? {},
        startupTimeoutMs: 10_000,
        requestTimeoutMs: 30_000,
      }

      const existing = this.servers.get(id)
      if (existing) {
        existing.config = { ...existing.config, ...normalized }
      } else {
        this.servers.set(id, {
          id,
          config: normalized,
          desiredRunning: false,
          status: 'stopped',
          lastError: null,
          transport: null,
          client: null,
          pid: null,
          stderrTail: [],
          connectedAtMs: null,
          lastActivityAtMs: null,
          idleKillTimer: null,
          restartAttempts: 0,
          restartTimer: null,
        })
      }
    }

    // If a server was removed from config, stop it and keep it disabled.
    for (const [id, handle] of this.servers.entries()) {
      if (!nextIds.has(id)) {
        handle.desiredRunning = false
        void this.stopServer(id)
      }
    }
  }

  getServerStatuses(): Array<{
    id: string
    status: McpServerStatus
    pid: number | null
    lastError: string | null
  }> {
    return Array.from(this.servers.entries()).map(([id, h]) => ({
      id,
      status: h.status,
      pid: h.pid,
      lastError: h.lastError,
    }))
  }

  /**
   * Starts all enabled servers from the last-loaded config file.
   *
   * This method never throws due to individual server failures; it returns a summary instead.
   */
  async startAll(): Promise<{ started: string[]; failed: Array<{ id: string; error: string }> }> {
    this.syncFromConfig()
    const started: string[] = []
    const failed: Array<{ id: string; error: string }> = []

    const handles = Array.from(this.servers.values())
    for (const handle of handles) {
      try {
        handle.desiredRunning = true
        await this.startServer(handle.id)
        started.push(handle.id)
      } catch (error) {
        const message = toErrorMessage(error)
        failed.push({ id: handle.id, error: message })
      }
    }

    return { started, failed }
  }

  async stopAll(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.stopServer(id)
    }
  }

  async startServer(id: string): Promise<void> {
    const handle = this.servers.get(id)
    if (!handle) {
      throw new Error(`Unknown MCP server id: ${id}`)
    }
    if (handle.status === 'running' && handle.client && handle.transport) {
      return
    }
    if (handle.status === 'starting') {
      // Best-effort: avoid double-start.
      throw new Error(`MCP server '${id}' is already starting`)
    }

    // Reset any prior state.
    await this.stopServer(id).catch(() => undefined)

    handle.status = 'starting'
    handle.lastError = null
    handle.stderrTail = []
    handle.connectedAtMs = null
    handle.lastActivityAtMs = null
    handle.restartAttempts = 0
    this.resetIdleKillTimer(id)

    const cfg = handle.config
    const serverParams: StdioServerParameters = {
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env ?? {},
      cwd: cfg.cwd,
      // Pipe stderr so we can surface useful startup errors.
      stderr: 'pipe',
    }

    const transport = new StdioClientTransport(serverParams)
    const client = new Client(this.clientInfo, {
      // Keep capabilities minimal; we mainly want tools.
      capabilities: {},
    })

    // Capture stderr for diagnostics.
    transport.stderr?.on('data', (chunk: any) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk)
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const line of lines) {
        handle.stderrTail.push(line)
        if (handle.stderrTail.length > 200) {
          handle.stderrTail.shift()
        }
      }
    })

    transport.onerror = (err) => {
      const msg = toErrorMessage(err)
      handle.lastError = msg
      logger.warn(`[MCP] transport error (${id}): ${msg}`)
    }
    transport.onclose = () => {
      // If it closes unexpectedly while "running", reflect that.
      if (handle.status === 'running') {
        handle.status = 'error'
        handle.lastError = handle.lastError ?? 'Transport closed'
        if (handle.desiredRunning) {
          this.scheduleRestart(handle.id, 'Transport closed')
        }
      } else if (handle.status === 'starting') {
        handle.status = 'error'
        handle.lastError = handle.lastError ?? 'Transport closed during startup'
        if (handle.desiredRunning) {
          this.scheduleRestart(handle.id, 'Transport closed during startup')
        }
      } else {
        handle.status = 'stopped'
      }
      handle.pid = null
      handle.connectedAtMs = null
    }

    handle.transport = transport
    handle.client = client

    const startupTimeoutMs = cfg.startupTimeoutMs ?? 10_000

    try {
      await withTimeout(client.connect(transport), startupTimeoutMs, `MCP server '${id}' startup`)
      handle.pid = transport.pid
      handle.connectedAtMs = Date.now()
      handle.lastActivityAtMs = Date.now()
      this.resetIdleKillTimer(id)
      handle.status = 'running'
      handle.restartAttempts = 0
      logger.system(`[MCP] server '${id}' connected (pid=${handle.pid ?? 'n/a'})`)
      void this.updateNativeMenuBar()
    } catch (error) {
      const message = toErrorMessage(error)
      handle.status = 'error'
      handle.lastError = this.decorateServerError(id, message)
      await this.stopServer(id).catch(() => undefined)
      if (handle.desiredRunning) {
        this.scheduleRestart(id, handle.lastError)
      }
      throw new Error(handle.lastError)
    }
  }

  async stopServer(id: string): Promise<void> {
    const handle = this.servers.get(id)
    if (!handle) return

    handle.desiredRunning = false

    if (handle.idleKillTimer) {
      clearTimeout(handle.idleKillTimer)
      handle.idleKillTimer = null
    }
    if (handle.restartTimer) {
      clearTimeout(handle.restartTimer)
      handle.restartTimer = null
    }

    const transport = handle.transport
    const client = handle.client

    handle.transport = null
    handle.client = null
    handle.pid = null
    handle.connectedAtMs = null
    handle.lastActivityAtMs = null

    // Close protocol then transport (best-effort).
    await client?.close().catch(() => undefined)
    await transport?.close().catch(() => undefined)

    if (handle.status !== 'error') {
      handle.status = 'stopped'
      handle.lastError = null
    }

    void this.updateNativeMenuBar()
  }

  /**
   * Lists tools from all currently running servers.
   *
   * Servers that fail or time out are skipped, with their `lastError` updated.
   */
  async listAvailableTools(): Promise<McpToolDescriptor[]> {
    const results: McpToolDescriptor[] = []

    for (const [id, handle] of this.servers.entries()) {
      if (handle.status !== 'running' || !handle.client) continue

      const requestTimeoutMs = handle.config.requestTimeoutMs ?? 30_000

      try {
        const { tools } = await withTimeout(
          handle.client.listTools(),
          requestTimeoutMs,
          `MCP listTools '${id}'`,
        )
        for (const tool of tools) {
          results.push({
            serverId: id,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as any,
            outputSchema: tool.outputSchema as any,
            annotations: tool.annotations as any,
            title: tool.title,
          })
        }
      } catch (error) {
        const message = toErrorMessage(error)
        handle.lastError = this.decorateServerError(id, message)
        logger.warn(`[MCP] listTools failed (${id}): ${handle.lastError}`)
      }
    }

    return results
  }

  /**
   * Aggregates tools across all active MCP servers with a unique, server-prefixed name.
   * Example: `github-create-issue`, `postgres-query`.
   */
  async getAllTools(): Promise<McpToolDescriptor[]> {
    const tools = await this.listAvailableTools()
    return tools.map((t) => ({
      ...t,
      name: `${t.serverId}-${t.name}`,
    }))
  }

  /**
   * Calls a tool on a specific server. If `serverId` is omitted, the tool name must be unique across servers.
   */
  async callTool(options: {
    name: string
    arguments?: Record<string, unknown>
    serverId?: string
  }): Promise<McpCallToolResult> {
    const toolName = options.name
    const args = options.arguments ?? {}

    const targetServerId = options.serverId ?? (await this.resolveUniqueToolServerId(toolName))
    const handle = this.servers.get(targetServerId)
    if (!handle) {
      throw new Error(`Unknown MCP server id: ${targetServerId}`)
    }

    // Lazy-load: if the server is stopped (or was killed due to idleness), respawn on demand.
    if (handle.status !== 'running' || !handle.client) {
      await this.startServer(targetServerId)
    }

    const ready = this.servers.get(targetServerId)
    if (!ready || ready.status !== 'running' || !ready.client) {
      throw new Error(`MCP server '${targetServerId}' is not running`)
    }

    const requestTimeoutMs = ready.config.requestTimeoutMs ?? 30_000

    try {
      recordEnergyImpact('mcp_tool_execution')
      ready.lastActivityAtMs = Date.now()
      this.resetIdleKillTimer(targetServerId)
      this.toolInFlight += 1
      void this.updateNativeMenuBar()
      const raw = await withTimeout(
        ready.client.callTool({ name: toolName, arguments: args as any }),
        requestTimeoutMs,
        `MCP callTool '${toolName}' on '${targetServerId}'`,
      )
      return { serverId: targetServerId, toolName, raw }
    } catch (error) {
      const message = toErrorMessage(error)
      const decorated = this.decorateServerError(targetServerId, message)
      ready.lastError = decorated
      // Best-effort: if the server is unhealthy, attempt restart in background.
      if (ready.desiredRunning) {
        this.scheduleRestart(targetServerId, decorated)
      }
      throw new Error(decorated)
    } finally {
      this.toolInFlight = Math.max(0, this.toolInFlight - 1)
      void this.updateNativeMenuBar()
    }
  }

  private scheduleRestart(serverId: string, reason: string): void {
    const handle = this.servers.get(serverId)
    if (!handle) return
    if (!handle.desiredRunning) return
    if (handle.restartTimer) return

    handle.restartAttempts += 1
    const backoffMs = Math.min(60_000, 1_000 * Math.pow(2, Math.min(6, handle.restartAttempts - 1)))
    logger.warn(
      `[MCP] server '${serverId}' restarting in ${backoffMs}ms (attempt ${handle.restartAttempts}): ${reason}`,
    )

    handle.restartTimer = setTimeout(() => {
      handle.restartTimer = null
      if (!handle.desiredRunning) return
      void this.startServer(serverId).catch((error) => {
        // Never throw up to the main process.
        handle.lastError = toErrorMessage(error)
        this.scheduleRestart(serverId, handle.lastError)
      })
    }, backoffMs)
    ;(handle.restartTimer as any).unref?.()
  }

  private resetIdleKillTimer(serverId: string): void {
    const handle = this.servers.get(serverId)
    if (!handle) return

    if (handle.idleKillTimer) {
      clearTimeout(handle.idleKillTimer)
      handle.idleKillTimer = null
    }

    // Only run the idle killer for active/runnable servers.
    if (handle.status !== 'running') return

    handle.idleKillTimer = setTimeout(() => {
      const h = this.servers.get(serverId)
      if (!h) return
      const last = h.lastActivityAtMs ?? h.connectedAtMs ?? Date.now()
      const idleFor = Date.now() - last
      if (idleFor < this.idleKillMs) {
        // Activity happened; reschedule.
        this.resetIdleKillTimer(serverId)
        return
      }

      logger.system(
        `[MCP] server '${serverId}' idle for ${Math.round(idleFor / 1000)}s, stopping (lazy-load enabled)`,
      )
      void this.stopServer(serverId)
    }, this.idleKillMs)
    ;(handle.idleKillTimer as any).unref?.()
  }

  private async resolveUniqueToolServerId(toolName: string): Promise<string> {
    const tools = await this.listAvailableTools()
    const matches = tools.filter((t) => t.name === toolName)
    if (matches.length === 0) {
      throw new Error(`No MCP server exposes a tool named '${toolName}'`)
    }
    const unique = new Set(matches.map((m) => m.serverId))
    if (unique.size !== 1) {
      throw new Error(
        `Tool '${toolName}' is ambiguous across servers: ${Array.from(unique).join(', ')}. Pass { serverId } explicitly.`,
      )
    }
    return matches[0].serverId
  }

  private decorateServerError(serverId: string, message: string): string {
    const handle = this.servers.get(serverId)
    const tail = handle?.stderrTail?.slice(-20) ?? []
    if (tail.length === 0) {
      return message
    }
    return `${message}\n--- ${serverId} stderr (tail) ---\n${tail.join('\n')}`
  }
}
