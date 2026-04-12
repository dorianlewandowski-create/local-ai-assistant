import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { resolveNativeBridgePath } from '@apex/macos-node'
import { nativeBridge } from '@apex/macos-node'

const ACCESSIBILITY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const SCREEN_RECORDING_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

function resolveBridgeBinaryPath(): string {
  return resolveNativeBridgePath()
}

function logUserFriendlyActionPlan(details?: { systemHint?: string }) {
  logger.system('─'.repeat(72))
  logger.system('Apex Native Bridge: Permissions Needed')
  if (details?.systemHint) {
    logger.system(details.systemHint)
  }
  logger.system('')
  logger.system('User-Friendly Action Plan')
  logger.system('1) Open Accessibility settings:')
  logger.system(`   open "${ACCESSIBILITY_URL}"`)
  logger.system('2) Add/enable the following (whichever applies to how you run Apex):')
  logger.system('   - claw-native-bridge (Swift binary)')
  logger.system('   - Terminal / iTerm (if you run from a terminal)')
  logger.system('   - node (the binary used by launchd, if running as a daemon)')
  logger.system('3) Restart the daemon after granting permission.')
  logger.system('')
  logger.system('If you will use ScreenCaptureKit screenshots, also grant Screen Recording:')
  logger.system(`   open "${SCREEN_RECORDING_URL}"`)
  logger.system('─'.repeat(72))
}

/**
 * Startup diagnostic for the native Swift bridge.
 *
 * If the bridge is present but lacks Accessibility permissions, this logs a
 * user-friendly action plan (including direct System Settings deep links).
 *
 * This function is intentionally non-fatal and should not block startup.
 */
export function runNativeBridgeStartupDiagnostic(): void {
  const binaryPath = resolveBridgeBinaryPath()
  if (!fs.existsSync(binaryPath)) {
    return
  }

  void (async () => {
    try {
      // Keep this extremely lightweight. A shallow scan is enough to detect permission issues.
      await nativeBridge.getUiTree(2, 50)
    } catch (error: any) {
      const meta = error?.nativeBridge
      if (meta?.code === -25204 || meta?.kind === 'permissions') {
        logUserFriendlyActionPlan({ systemHint: meta?.systemHint })
      }
    }
  })()
}
