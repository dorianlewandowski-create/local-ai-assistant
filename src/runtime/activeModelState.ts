import { EventEmitter } from 'node:events'

export type ActiveModelState = {
  provider: 'gemini' | 'local'
  model: string
  tier?: string
  updatedAt: string
  note?: string
}

class ActiveModelBroadcaster {
  private current: ActiveModelState | null = null
  readonly events = new EventEmitter()

  get(): ActiveModelState | null {
    return this.current
  }

  set(next: Omit<ActiveModelState, 'updatedAt'>): void {
    const state: ActiveModelState = { ...next, updatedAt: new Date().toISOString() }
    this.current = state
    this.events.emit('change', state)
  }
}

export const activeModelState = new ActiveModelBroadcaster()
