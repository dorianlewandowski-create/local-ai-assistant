import { EventEmitter } from 'node:events'
import { config } from '@apex/core'

export type ActiveBrain = 'local' | 'gemini'
export type RouterMode = 'always_gemini' | 'always_local' | 'smart'

type RuntimeSettingsState = {
  activeBrain: ActiveBrain
  routerMode: RouterMode
  privacyMode: boolean
}

function normalizeActiveBrain(raw: unknown): ActiveBrain {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
  return v === 'gemini' ? 'gemini' : 'local'
}

function normalizeRouterMode(raw: unknown): RouterMode {
  const v = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (v === 'always_gemini') return 'always_gemini'
  if (v === 'always_local') return 'always_local'
  return 'smart'
}

class RuntimeSettings extends EventEmitter {
  private state: RuntimeSettingsState = {
    activeBrain: normalizeActiveBrain((config as any).current_provider),
    routerMode: normalizeRouterMode((config as any).routerMode),
    privacyMode: (config as any).privacyMode ?? false,
  }

  get() {
    return { ...this.state }
  }

  setActiveBrain(activeBrain: ActiveBrain) {
    if (this.state.activeBrain === activeBrain) return
    this.state = { ...this.state, activeBrain }
    this.emit('change', this.get())
    this.emit('activeBrain', activeBrain)
  }

  setRouterMode(routerMode: RouterMode) {
    if (this.state.routerMode === routerMode) return
    this.state = { ...this.state, routerMode }
    this.emit('change', this.get())
    this.emit('routerMode', routerMode)
  }

  setPrivacyMode(privacyMode: boolean) {
    if (this.state.privacyMode === privacyMode) return
    this.state = { ...this.state, privacyMode }
    this.emit('change', this.get())
    this.emit('privacyMode', privacyMode)
  }
}

export const runtimeSettings = new RuntimeSettings()
