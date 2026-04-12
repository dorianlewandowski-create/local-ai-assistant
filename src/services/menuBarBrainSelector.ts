import { nativeBridge } from '@apex/macos-node'
import { runtimeSettings } from '../runtime/runtimeSettings'
import { logger } from '../utils/logger'
import { routerService } from './RouterService'

type MenuBarAction =
  | 'switch_local'
  | 'switch_gemini'
  | 'switch_smart'
  | 'switch_local_recommended'
  | 'test_gemini'

function isMenuBarActionEvent(event: any): event is { type: 'MENU_BAR_ACTION'; data?: { action?: string } } {
  return event?.type === 'MENU_BAR_ACTION'
}

async function testGeminiConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await routerService.query('Reply with exactly: OK', {
      model: 'gemini-3.1-pro-preview',
      messages: [],
      tools: [],
    })
    const ok = (res.text ?? '').trim().toUpperCase().includes('OK')
    return { ok, message: ok ? 'Gemini OK' : `Gemini responded: ${res.text?.slice(0, 80) ?? ''}` }
  } catch (error: any) {
    return { ok: false, message: `Gemini test failed: ${error?.message ?? String(error)}` }
  }
}

export function startMenuBarBrainSelector() {
  let uiInFlight = false
  const applyUi = async () => {
    if (uiInFlight) return
    uiInFlight = true
    const { activeBrain, routerMode } = runtimeSettings.get()
    const offer = routerService.shouldOfferSwitchToLocal()
    const modeLabel = routerMode === 'smart' ? 'Smart' : activeBrain === 'gemini' ? 'Gemini' : 'Local'
    const title = `Apex · ${modeLabel}`
    try {
      await nativeBridge.configureBrainSelector({
        activeBrain,
        routerMode,
        recommendLocal: offer.offer,
        title,
      })
    } catch {
      // If bridge isn't available, ignore.
    } finally {
      uiInFlight = false
    }
  }

  void applyUi()

  runtimeSettings.on('activeBrain', () => {
    void applyUi()
  })
  runtimeSettings.on('routerMode', () => {
    void applyUi()
  })

  // Refresh periodically so latency-driven recommendations show up mid-session.
  const refresh = setInterval(() => {
    void applyUi()
  }, 5000)
  refresh.unref?.()

  routerService.events.on('fallback', (event: any) => {
    if (event?.from !== 'gemini' || event?.to !== 'local') return
    logger.system(`[Router] Fallback Gemini → Local: ${event?.reason ?? ''}`)

    // Reflect “what’s powering Talk Mode right now” without forcing a persistent mode switch.
    runtimeSettings.setActiveBrain('local')
    void applyUi()

    void nativeBridge
      .updateMenuBarStatus({ statusText: 'Switched to Local Mode', blink: true })
      .catch(() => undefined)

    // After a moment, restore the normal title (without restarting anything).
    setTimeout(() => {
      void applyUi()
    }, 2500).unref?.()
  })

  nativeBridge.onSystemEvent((event: any) => {
    if (!isMenuBarActionEvent(event)) return
    const action = event.data?.action as any as
      | MenuBarAction
      | 'switch_smart'
      | 'switch_local_recommended'
      | undefined
    if (!action) return

    if (action === 'switch_local') {
      runtimeSettings.setRouterMode('always_local')
      runtimeSettings.setActiveBrain('local')
      logger.system('[MenuBar] Switched to Local brain.')
      void nativeBridge
        .updateMenuBarStatus({ statusText: 'Apex (Local)', blink: false })
        .catch(() => undefined)
      return
    }

    if (action === 'switch_gemini') {
      runtimeSettings.setRouterMode('always_gemini')
      runtimeSettings.setActiveBrain('gemini')
      logger.system('[MenuBar] Switched to Gemini brain.')
      void nativeBridge
        .updateMenuBarStatus({ statusText: 'Apex (Gemini)', blink: false })
        .catch(() => undefined)
      return
    }

    if (action === 'switch_smart') {
      runtimeSettings.setRouterMode('smart')
      // Keep the current activeBrain as the “last used” indicator; Smart may still choose either.
      logger.system('[MenuBar] Switched to Smart mode.')
      void nativeBridge
        .updateMenuBarStatus({ statusText: 'Apex (Smart)', blink: false })
        .catch(() => undefined)
      void applyUi()
      return
    }

    if (action === 'switch_local_recommended') {
      runtimeSettings.setRouterMode('always_local')
      runtimeSettings.setActiveBrain('local')
      logger.system('[MenuBar] Switched to Local (recommended).')
      void nativeBridge
        .updateMenuBarStatus({ statusText: 'Apex (Local)', blink: false })
        .catch(() => undefined)
      void applyUi()
      return
    }

    if (action === 'test_gemini') {
      void (async () => {
        void nativeBridge
          .updateMenuBarStatus({ statusText: 'Testing Gemini…', blink: true })
          .catch(() => undefined)
        const result = await testGeminiConnection()
        runtimeSettings.setActiveBrain('gemini')
        runtimeSettings.setRouterMode('always_gemini')
        void nativeBridge
          .updateMenuBarStatus({ statusText: result.message, blink: !result.ok })
          .catch(() => undefined)
        void applyUi()
      })()
    }
  })
}
