import { readRecentSecurityAudit, runtimeSecurityState, type SecurityAuditEvent } from '@apex/core'
import { sessionStore, SessionSummary } from './sessionStore'
import { memoryStore } from '../db/memory'
import { getVectorStore } from '../db/vectorStore'
import type { SubAgentKind, TaskEnvelope } from '@apex/types'
import { runtimeSettings } from './runtimeSettings'

export interface RuntimeServices {
  getSessionCount(): number
  listSessions(limit: number): SessionSummary[]
  getSessionModel(task: TaskEnvelope): string | undefined
  setSessionModel(task: TaskEnvelope, model: string): void
  getSessionSandboxMode(task: TaskEnvelope): 'default' | 'strict' | 'off' | undefined
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off'): void
  getSessionSubAgentKind(task: TaskEnvelope): SubAgentKind | undefined
  setSessionSubAgentKind(task: TaskEnvelope, kind: SubAgentKind | undefined): void
  countFacts(): number
  countVectors(): Promise<number>
  isRemoteSafeModeEnabled(): boolean
  setRemoteSafeMode(enabled: boolean): void
  getActiveBrain(): 'local' | 'gemini'
  setActiveBrain(activeBrain: 'local' | 'gemini'): void
  getRouterMode(): 'always_gemini' | 'always_local' | 'smart'
  setRouterMode(routerMode: 'always_gemini' | 'always_local' | 'smart'): void
  readRecentAudit(limit: number): Promise<SecurityAuditEvent[]>
}

export const runtimeServices: RuntimeServices = {
  getSessionCount() {
    return sessionStore.count()
  },
  listSessions(limit: number) {
    return sessionStore.listSessions(limit)
  },
  getSessionModel(task: TaskEnvelope) {
    return sessionStore.getSession(task).settings.model
  },
  setSessionModel(task: TaskEnvelope, model: string) {
    void sessionStore.updateSessionSettings(task, { model })
  },
  getSessionSandboxMode(task: TaskEnvelope) {
    return sessionStore.getSession(task).settings.sandboxMode
  },
  setSessionSandboxMode(task: TaskEnvelope, mode: 'default' | 'strict' | 'off') {
    void sessionStore.updateSessionSettings(task, { sandboxMode: mode })
  },
  getSessionSubAgentKind(task: TaskEnvelope) {
    return sessionStore.getSession(task).settings.subAgentKind
  },
  setSessionSubAgentKind(task: TaskEnvelope, kind: SubAgentKind | undefined) {
    void sessionStore.updateSessionSettings(task, { subAgentKind: kind })
  },
  countFacts() {
    return memoryStore.count()
  },
  countVectors() {
    return getVectorStore().count()
  },
  isRemoteSafeModeEnabled() {
    return runtimeSecurityState.isRemoteSafeModeEnabled()
  },
  setRemoteSafeMode(enabled: boolean) {
    runtimeSecurityState.setRemoteSafeMode(enabled)
  },
  getActiveBrain() {
    return runtimeSettings.get().activeBrain
  },
  setActiveBrain(activeBrain: 'local' | 'gemini') {
    runtimeSettings.setActiveBrain(activeBrain)
  },
  getRouterMode() {
    return runtimeSettings.get().routerMode
  },
  setRouterMode(routerMode: 'always_gemini' | 'always_local' | 'smart') {
    runtimeSettings.setRouterMode(routerMode)
  },
  readRecentAudit(limit: number) {
    return readRecentSecurityAudit(limit)
  },
}
