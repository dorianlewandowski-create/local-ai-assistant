import { toolRegistry } from '../tools/registry'
import { logger as rootLogger } from '../utils/logger'
import { nativeBridge } from '@apex/macos-node'
import { MacSandbox } from '../sandbox/MacSandbox'
import { recordEnergyImpact } from '../utils/energyImpact'
import type { Tool } from '@apex/types'
import { PluginPermission } from '../sdk/types'
import type {
  OpenMacPlugin,
  OpenMacPluginMetadata,
  PluginContext,
  PluginEnergyScore,
  PluginPermission as PluginPermissionName,
} from '../sdk/types'

const sharedSandbox = new MacSandbox()
const energyScores = new Map<string, PluginEnergyScore>()
const screenCaptureDisabled = new Set<string>()

function pluginKey(plugin: OpenMacPlugin): string {
  return plugin.metadata?.name || 'unknown-plugin'
}

function resolveRequestedPermissions(plugin: OpenMacPlugin): PluginPermissionName[] {
  const metadata: any = plugin.metadata ?? {}
  const raw = metadata.permissions ?? metadata.permissionsRequired ?? []
  const normalized = Array.isArray(raw) ? raw.map((p: any) => String(p).toLowerCase().trim()) : []

  const out = new Set<PluginPermissionName>()
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
    // Back-compat alias: "untrustedexecution" == sandbox permission
    if (item === 'sandbox' || item === 'untrustedexecution') out.add('sandbox')
    if (item === 'tools.register' || item === 'registertool' || item === 'register_tool')
      out.add('tools.register')
    if (item === 'screen_capture' || item === 'screencapture' || item === 'screen-capture')
      out.add('screen_capture')
    if (item === 'filesystem.read') out.add('filesystem.read')
    if (item === 'filesystem.write') out.add('filesystem.write')
    if (item === 'automation') out.add('automation')
  }

  return Array.from(out.values())
}

function deniedProxy(pluginName: string, capability: string) {
  return () => {
    throw new Error(
      `[Permission Denied] Plugin "${pluginName}" attempted to use "${capability}" but did not request permission for it.`,
    )
  }
}

function shouldDisableScreenCaptureFromError(error: any): boolean {
  const hint = String(error?.nativeBridge?.systemHint ?? '')
  const msg = String(error?.message ?? '')
  return (
    hint.toLowerCase().includes('screen recording permissions') ||
    msg.toLowerCase().includes('screen recording') ||
    msg.toLowerCase().includes('screencapturekit')
  )
}

/**
 * Create a permission-scoped PluginContext.
 *
 * - Starts with base fields (logger/config/energyScore)
 * - Attaches capabilities based on plugin metadata permissions
 * - Uses proxies that throw clear "Permission Denied" errors when accessed without permission
 * - For `screen_capture`, uses best-effort runtime detection: on first ScreenCapture failure that
 *   looks permission-related, logs a warning and disables screen capture for that plugin.
 */
export function createPluginContext(plugin: OpenMacPlugin): PluginContext {
  const name = pluginKey(plugin)
  const requested = resolveRequestedPermissions(plugin)
  const has = (perm: string) => requested.includes(perm as any)

  const energyScore = energyScores.get(name) ?? { totalMs: 0, loadMs: 0, eventMs: 0 }
  energyScores.set(name, energyScore)
  const manifest: OpenMacPluginMetadata | null =
    (plugin.metadata as OpenMacPluginMetadata | undefined) ?? null

  const logger = {
    debug: (message: string) => rootLogger.debug(`[plugin:${name}] ${message}`),
    system: (message: string) => rootLogger.system(`[plugin:${name}] ${message}`),
    warn: (message: string) => rootLogger.warn(`[plugin:${name}] ${message}`),
    error: (message: string) => rootLogger.error(`[plugin:${name}] ${message}`),
  }

  const context: PluginContext = {
    logger,
    manifest,
    config: {},
    energyScore,
    energy: {
      reportUsage: (ms: number) => {
        const amount = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0
        if (amount > 0) {
          recordEnergyImpact('plugin_execution', amount)
        }
      },
    },
    requireBridge: () => {
      if (!context.bridge) {
        logger.error(
          `Permission Denied: missing ${PluginPermission.Accessibility} (or ${PluginPermission.NativeBridge}) in manifest permissions.`,
        )
        throw new Error(
          `[Permission Denied] Plugin "${name}" attempted to use "bridge" but did not request permission for it.`,
        )
      }
      return context.bridge
    },
    requireSandbox: () => {
      if (!context.sandbox) {
        logger.error(
          `Permission Denied: missing ${PluginPermission.UntrustedExecution} in manifest permissions.`,
        )
        throw new Error(
          `[Permission Denied] Plugin "${name}" attempted to use "sandbox" but did not request permission for it.`,
        )
      }
      return context.sandbox
    },
    requireRegisterTool: () => {
      if (!context.registerTool) {
        logger.error(`Permission Denied: missing ${PluginPermission.ToolsRegister} in manifest permissions.`)
        throw new Error(
          `[Permission Denied] Plugin "${name}" attempted to use "registerTool" but did not request permission for it.`,
        )
      }
      return context.registerTool
    },
  }

  // Native bridge (AX/UI tree)
  if (has(PluginPermission.Accessibility) || has(PluginPermission.NativeBridge)) {
    const base = {
      getUiTree: async (...args: any[]) => {
        if (!nativeBridge.isActive()) {
          logger.warn(`Missing Host Permission: Swift bridge is not active. Cannot call getUiTree.`)
          throw new Error('Native bridge is not available.')
        }
        return (nativeBridge.getUiTree as any).apply(nativeBridge, args)
      },
      updateMenuBarStatus: async (...args: any[]) => {
        if (!nativeBridge.isActive()) {
          logger.warn(`Missing Host Permission: Swift bridge is not active. Cannot call updateMenuBarStatus.`)
          throw new Error('Native bridge is not available.')
        }
        return (nativeBridge.updateMenuBarStatus as any).apply(nativeBridge, args)
      },
    } as any

    // Screen capture is permission-gated separately.
    if (has(PluginPermission.ScreenCapture)) {
      if (!nativeBridge.isActive()) {
        logger.warn(
          `Missing Host Permission: screen_capture requested but Swift bridge is not active. Disabling screen capture for this plugin.`,
        )
      } else if (screenCaptureDisabled.has(name)) {
        logger.warn(
          `screen_capture is disabled for this plugin due to missing macOS Screen Recording permission.`,
        )
      } else {
        base.captureScreen = async (...args: any[]) => {
          if (screenCaptureDisabled.has(name)) {
            throw new Error(
              `[Permission Denied] Plugin "${name}" screen_capture is disabled (missing macOS Screen Recording permission).`,
            )
          }
          if (!nativeBridge.isActive()) {
            logger.warn(`Missing Host Permission: Swift bridge is not active. Cannot call captureScreen.`)
            throw new Error('Native bridge is not available.')
          }
          try {
            return await nativeBridge.captureScreen(...args)
          } catch (error: any) {
            if (shouldDisableScreenCaptureFromError(error)) {
              screenCaptureDisabled.add(name)
              logger.warn(
                `Missing Host Permission: macOS Screen Recording permission appears missing. Disabling screen_capture for this plugin.`,
              )
            }
            throw error
          }
        }
      }
    }

    context.bridge = base
  } else {
    context.bridge = undefined
  }

  if (has(PluginPermission.UntrustedExecution)) {
    context.sandbox = sharedSandbox
  } else {
    context.sandbox = undefined
  }

  if (has('tools.register')) {
    context.registerTool = (tool: Tool) => toolRegistry.register(tool)
  } else {
    context.registerTool = undefined
  }

  return context
}
