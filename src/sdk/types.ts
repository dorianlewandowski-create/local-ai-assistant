import type { z } from 'zod'
import type { SystemEvent, Tool } from '@apex/types'
import type { MacSandbox } from '../sandbox/MacSandbox'
import type { NativeBridge } from '@apex/macos-node'

export type { SystemEvent } from '@apex/types'

export type PluginPermission =
  | 'nativeBridge'
  | 'accessibility'
  | 'screen_capture'
  | 'sandbox'
  | 'tools.register'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'automation'

/**
 * Constant-style permission keys for plugin manifests.
 *
 * This enables `PluginPermission.Accessibility`-style usage while keeping the
 * underlying type as a string union.
 */
export const PluginPermission = {
  Accessibility: 'accessibility',
  UntrustedExecution: 'sandbox',
  NativeBridge: 'nativeBridge',
  ScreenCapture: 'screen_capture',
  Sandbox: 'sandbox',
  ToolsRegister: 'tools.register',
  FilesystemRead: 'filesystem.read',
  FilesystemWrite: 'filesystem.write',
  Automation: 'automation',
} as const

export type OpenMacPluginMetadata = {
  name: string
  version: string
  /**
   * Declares which host capabilities the plugin expects to use.
   * The host should treat this as an allowlist request (not a grant).
   */
  permissions: PluginPermission[]
  /**
   * Back-compat: older plugins used `permissionsRequired`.
   * Prefer `permissions` going forward.
   */
  permissionsRequired?: PluginPermission[]
  /**
   * Optional manifest of tools the plugin provides.
   *
   * This allows the host (main thread) to register proxy tools without running
   * plugin code in-process, while still executing tool logic inside an isolated worker.
   */
  tools?: Array<{
    /** Tool name (without plugin prefix). */
    name: string
    description: string
    /** JSON schema for tool parameters. */
    parametersJsonSchema: unknown
  }>
}

/**
 * When provided by a file-based plugin, `manifest.json` (or equivalent) should
 * serialize to this shape.
 */
export type OpenMacPluginManifestFile = OpenMacPluginMetadata & {
  /**
   * Relative entrypoint path inside the plugin folder (e.g. "dist/index.js").
   */
  main: string
}

export type ScopedLogger = {
  debug(message: string): void
  system(message: string): void
  warn(message: string): void
  error(message: string): void
}

export type RegisterTool = <TParams extends z.ZodObject<any>>(tool: Tool<TParams>) => void

export type PluginEnergyScore = {
  /**
   * Cumulative "cost" as measured by the host, in milliseconds.
   * The host updates this when calling `onLoad`/`onEvent`.
   */
  totalMs: number
  loadMs: number
  eventMs: number
  lastLoadMs?: number
  lastEventMs?: number
  lastEventType?: string
}

/**
 * "God Object" passed to plugins.
 *
 * Note: these are references to controlled host capabilities. The host should
 * scope and validate any sensitive operations at runtime.
 */
export type PluginContext<TConfig = unknown> = {
  /** A logger scoped/namespaced to the plugin. */
  logger: ScopedLogger
  /** The plugin's declared manifest metadata. */
  manifest: OpenMacPluginMetadata | null
  /** Plugin-specific configuration (already scoped to the plugin). */
  config: TConfig
  /** Host-maintained view of how "hungry" the plugin is. */
  energyScore: PluginEnergyScore
  /**
   * Energy attribution interface for plugins/host to report usage.
   */
  energy: {
    reportUsage(ms: number): void
  }
  /** Access to the Swift native bridge client. */
  bridge?: NativeBridge
  /** Access to the sandboxed code execution environment. */
  sandbox?: MacSandbox
  /** Register Zod-based tools into the global registry. */
  registerTool?: RegisterTool

  /**
   * Runtime helpers that either return the capability or throw a clear error.
   * Prefer these inside plugins to avoid confusing `undefined` errors.
   */
  requireBridge(): NativeBridge
  requireSandbox(): MacSandbox
  requireRegisterTool(): RegisterTool
}

export interface OpenMacPlugin<TConfig = unknown> {
  /**
   * Optional in-module metadata. If not present, the host should load metadata
   * from the plugin's `manifest.json` (or equivalent manifest file).
   */
  metadata?: OpenMacPluginMetadata

  /** Called once when the plugin is loaded. */
  onLoad(context: PluginContext<TConfig>): void | Promise<void>

  /** Called once when the plugin is unloaded. */
  onUnload(): void | Promise<void>

  /** Called whenever the host emits a system event to the plugin. */
  onEvent(event: SystemEvent): void | Promise<void>

  /**
   * Optional: execute a declared tool inside the plugin worker.
   *
   * The host registers proxy tools (from `metadata.tools` or manifest tools)
   * and dispatches calls into the worker via `callTool`.
   */
  callTool?(toolName: string, args: unknown): unknown | Promise<unknown>
}

/**
 * Recommended module shape for external plugins.
 *
 * - Export `default` (or `plugin`) implementing `OpenMacPlugin`
 * - Provide metadata either via `export const metadata = ...` OR a manifest file
 */
export type OpenMacPluginModule<TConfig = unknown> = {
  default?: OpenMacPlugin<TConfig>
  plugin?: OpenMacPlugin<TConfig>
  metadata?: OpenMacPluginMetadata
}
