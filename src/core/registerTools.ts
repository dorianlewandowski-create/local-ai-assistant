import { config } from '@apex/core'
import { discoverExternalPlugins, registerPlugins } from '../plugins/loader'
import { builtinToolsPlugin } from '../plugins/builtinTools'
import { mcpBridgePlugin } from '../plugins/mcpBridge'
import { PluginLoader } from './pluginLoader'

export const pluginLoader = new PluginLoader()

export async function registerCoreTools(): Promise<void> {
  registerPlugins([builtinToolsPlugin, mcpBridgePlugin, ...discoverExternalPlugins()])

  // Node's `--test` runner should not boot worker-thread plugins.
  // It can keep the event loop alive and isn't needed for unit tests.
  const runningUnderNodeTest =
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.argv.some((arg) => arg.includes('/test/') || arg.includes('\\test\\') || arg.includes('.test.'))

  // Allow explicit override for integration tests (`APEX_SDK_PLUGINS=1` → config.plugins.forceSdkPlugins).
  const forceSdkPlugins = config.plugins.forceSdkPlugins

  if (runningUnderNodeTest && !forceSdkPlugins) {
    return
  }

  // Load SDK-style plugins from `src/plugins/*/index.{ts,js}`.
  // This keeps the core tool pack clean (no direct imports per tool module).
  try {
    await pluginLoader.discoverAndLoadAll()
  } catch (error: any) {
    // Non-fatal: plugin boot should never prevent the app (or tests) from running.
    // Individual plugins are already isolated; this is just a final safety net.
    // eslint-disable-next-line no-console
    console.warn(`[plugins] failed to load sdk plugins: ${error?.message ?? String(error)}`)
  }
}
