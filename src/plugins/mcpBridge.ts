import { z } from 'zod'
import { toolRegistry } from '../tools/registry'
import type { Tool } from '@apex/types'
import { logger } from '../utils/logger'
import { McpHostManager, type McpToolDescriptor } from '../mcp/McpHostManager'
import { confirmSensitiveToolExecution, isSensitiveTool } from '../mcp/McpSecurityFilter'
import type { PluginManifest } from '@apex/types'

type JsonSchema = Record<string, any>

function safeToolName(name: string): string {
  // OpenAI/Ollama tool names should be simple. Preserve readability, avoid collisions.
  return name.replace(/[^a-zA-Z0-9_]+/g, '_')
}

function mcpToolToRegistryName(serverId: string, toolName: string): string {
  return safeToolName(`mcp_${serverId}__${toolName}`)
}

function jsonSchemaToZod(schema: JsonSchema, depth = 0): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any()
  }
  if (depth > 12) {
    return z.any()
  }

  const described = <T extends z.ZodTypeAny>(t: T) => {
    const desc = typeof schema.description === 'string' ? schema.description : undefined
    return desc ? t.describe(desc) : t
  }

  // Enums
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const allStrings = schema.enum.every((v: any) => typeof v === 'string')
    if (allStrings) {
      return described(z.enum(schema.enum as [string, ...string[]]))
    }
    return described(z.any())
  }

  const type = schema.type

  if (type === 'string') {
    let t: z.ZodTypeAny = z.string()
    if (typeof schema.minLength === 'number') t = (t as z.ZodString).min(schema.minLength)
    if (typeof schema.maxLength === 'number') t = (t as z.ZodString).max(schema.maxLength)
    return described(t)
  }

  if (type === 'number' || type === 'integer') {
    let t: z.ZodTypeAny = z.number()
    if (type === 'integer') t = (t as z.ZodNumber).int()
    if (typeof schema.minimum === 'number') t = (t as z.ZodNumber).min(schema.minimum)
    if (typeof schema.maximum === 'number') t = (t as z.ZodNumber).max(schema.maximum)
    return described(t)
  }

  if (type === 'boolean') {
    return described(z.boolean())
  }

  if (type === 'array') {
    const itemSchema = schema.items ? jsonSchemaToZod(schema.items, depth + 1) : z.any()
    let t: z.ZodTypeAny = z.array(itemSchema)
    if (typeof schema.minItems === 'number') t = (t as z.ZodArray<any>).min(schema.minItems)
    if (typeof schema.maxItems === 'number') t = (t as z.ZodArray<any>).max(schema.maxItems)
    return described(t)
  }

  if (type === 'object' || schema.properties || schema.required) {
    const properties: Record<string, z.ZodTypeAny> = {}
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}

    for (const [key, propSchema] of Object.entries(props)) {
      const zodProp = jsonSchemaToZod(propSchema as any, depth + 1)
      properties[key] = required.has(key) ? zodProp : zodProp.optional()
    }

    // Cast to avoid TS variance issues across unknownKeys modes (strip/strict/passthrough).
    let obj = z.object(properties) as unknown as z.ZodObject<any>
    // MCP tools often allow additional keys; preserve that unless explicitly forbidden.
    if (schema.additionalProperties === false) {
      obj = obj.strict() as unknown as z.ZodObject<any>
    } else {
      obj = obj.passthrough() as unknown as z.ZodObject<any>
    }

    return described(obj)
  }

  // anyOf/oneOf/allOf: best-effort as union of branches.
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : null
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : null

  if (anyOf && anyOf.length > 0) {
    const branches = anyOf.map((s: any) => jsonSchemaToZod(s, depth + 1))
    return described(z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]))
  }

  if (oneOf && oneOf.length > 0) {
    const branches = oneOf.map((s: any) => jsonSchemaToZod(s, depth + 1))
    return described(z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]))
  }

  if (allOf && allOf.length > 0) {
    // Intersection chaining.
    let acc = jsonSchemaToZod(allOf[0], depth + 1)
    for (const s of allOf.slice(1)) {
      acc = z.intersection(acc, jsonSchemaToZod(s, depth + 1))
    }
    return described(acc)
  }

  return z.any()
}

function extractTextFromMcpCallTool(raw: any): string {
  // MCP CallToolResult typically has { content: [...] } where content includes text blocks.
  if (raw && typeof raw === 'object' && Array.isArray(raw.content)) {
    const texts = raw.content
      .filter((c: any) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
    if (texts.length > 0) {
      return texts.join('\n')
    }
  }
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

class McpBridge {
  private readonly manager = new McpHostManager()
  private started = false

  /**
   * Startup-only initialization: load config, start enabled servers, then register tools once.
   * This is intentionally not polling to keep things "green".
   */
  async init(): Promise<void> {
    if (this.started) return
    this.started = true

    const summary = await this.manager.startAll()
    if (summary.failed.length > 0) {
      logger.warn(
        `[MCP] bridge: some servers failed to start: ${summary.failed.map((f) => `${f.id}: ${f.error}`).join('; ')}`,
      )
    }

    await this.refreshToolRegistry()
  }

  /**
   * Explicit refresh entrypoint (e.g., after adding/editing servers).
   * This does not poll; it reloads config and refreshes tool definitions once.
   */
  async reloadConfigAndRefresh(): Promise<void> {
    await this.manager.startAll()
    await this.refreshToolRegistry()
  }

  private async refreshToolRegistry(): Promise<void> {
    const tools = await this.manager.listAvailableTools()
    if (tools.length === 0) return

    for (const mcpTool of tools) {
      this.registerMcpTool(mcpTool)
    }

    logger.system(`[MCP] bridge: registered ${tools.length} tools`)
  }

  private registerMcpTool(mcpTool: McpToolDescriptor): void {
    const registryName = mcpToolToRegistryName(mcpTool.serverId, mcpTool.name)
    const paramsSchema = jsonSchemaToZod(mcpTool.inputSchema as any)

    // Tool.parameters must be a ZodObject for zod-to-json-schema.
    const parameters =
      paramsSchema instanceof z.ZodObject ? paramsSchema : z.object({ input: paramsSchema }).passthrough()

    const tool: Tool<any> = {
      name: registryName,
      description: `${mcpTool.description ?? mcpTool.title ?? mcpTool.name} (via MCP server '${mcpTool.serverId}' as '${mcpTool.name}')`,
      parameters: parameters as any,
      execute: async (args: any) => {
        try {
          const callArgs = parameters instanceof z.ZodObject ? args : args?.input

          // Security interceptor: check after LLM decides to call, before MCP request is sent.
          if (isSensitiveTool(mcpTool.serverId, mcpTool.name)) {
            const allowed = await confirmSensitiveToolExecution({
              serverId: mcpTool.serverId,
              toolName: mcpTool.name,
            })
            if (!allowed) {
              return {
                success: false,
                error: `User denied sensitive MCP tool execution: ${mcpTool.serverId}:${mcpTool.name}`,
              }
            }
          }

          const result = await this.manager.callTool({
            serverId: mcpTool.serverId,
            name: mcpTool.name,
            arguments: (callArgs ?? {}) as any,
          })

          const raw = (result as any).raw
          return {
            success: true,
            result: extractTextFromMcpCallTool(raw),
            data: { serverId: mcpTool.serverId, tool: mcpTool.name, raw },
          }
        } catch (error: any) {
          return { success: false, error: error?.message ?? String(error) }
        }
      },
    }

    toolRegistry.register(tool)
  }
}

export const mcpBridge = new McpBridge()

export const mcpBridgePlugin: PluginManifest = {
  id: 'mcp-bridge',
  description: 'Registers MCP server tools into the core tool registry',
  register() {
    // Fire-and-forget startup registration; no polling.
    void mcpBridge.init()
  },
}
