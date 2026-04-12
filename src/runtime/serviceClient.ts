import http from 'http'
import { config } from '@apex/core'
import { RuntimeApprovalSummary, RuntimeStatusSnapshot } from './api'
import type { SubAgentKind, TaskEnvelope } from '@apex/types'
import { LogEntry } from '../utils/logger'
import { fetchJsonWithTimeout } from './fetchWithTimeout'
import { readRuntimeServiceToken } from './runtimeServiceToken'

/** Must exceed server-side task timeout (see api.ts submitPrompt timeoutMs) so the client fails last with a clear error. */
const PROMPT_HTTP_TIMEOUT_MS = Math.max(
  125_000,
  Number(process.env.APEX_CLI_PROMPT_HTTP_TIMEOUT_MS || 0) || 125_000,
)
const CONTROL_HTTP_TIMEOUT_MS = Number(process.env.APEX_CLI_CONTROL_HTTP_TIMEOUT_MS || 20_000)
const READ_HTTP_TIMEOUT_MS = Number(process.env.APEX_CLI_READ_HTTP_TIMEOUT_MS || 12_000)

export type RuntimeServiceClientOptions = {
  /** When set (e.g. in-process host), avoids re-reading ~/.apex/runtime.token. */
  runtimeToken?: string
}

function resolveRuntimeToken(explicit?: string): string {
  const t = explicit ?? readRuntimeServiceToken()
  if (!t) {
    throw new Error(
      'Missing Apex runtime auth token. Start the daemon once (`apex daemon`) so it can create ~/.apex/runtime.token, or set APEX_RUNTIME_TOKEN / APEX_RUNTIME_TOKEN_FILE. See docs/OPERATOR_TRUST.txt and `apex runtime-info`.',
    )
  }
  return t
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Daemon JSON calls must use {@link fetchJsonWithTimeout}: plain `fetchWithTimeout` returns after
 * headers while `response.text()` / `.json()` can still block forever on a stalled body (frozen CLI).
 */
async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  token: string,
): Promise<any> {
  return await fetchJsonWithTimeout(
    `${baseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeaders(token),
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs,
      timeoutMessage: `Runtime service POST ${path} timed out after ${timeoutMs}ms`,
    },
  )
}

async function getJson(baseUrl: string, path: string, timeoutMs: number, token: string): Promise<any> {
  return await fetchJsonWithTimeout(
    `${baseUrl}${path}`,
    {
      method: 'GET',
      headers: authHeaders(token),
    },
    {
      timeoutMs,
      timeoutMessage: `Runtime service GET ${path} timed out after ${timeoutMs}ms`,
    },
  )
}

export function createRuntimeServiceClient(
  baseUrl = `http://127.0.0.1:${config.runtimeService.port}`,
  opts?: RuntimeServiceClientOptions,
) {
  const explicitToken = opts?.runtimeToken

  function token(): string {
    return resolveRuntimeToken(explicitToken)
  }

  return {
    async getStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
      return (await getJson(baseUrl, '/api/status', READ_HTTP_TIMEOUT_MS, token())) as RuntimeStatusSnapshot
    },
    getBaseUrl(): string {
      return baseUrl
    },
    async submitPrompt(
      source: TaskEnvelope['source'],
      sourceId: string,
      prompt: string,
      metadata?: Record<string, any>,
    ): Promise<string> {
      const result = await postJson(
        baseUrl,
        '/api/prompt',
        { source, sourceId, prompt, metadata },
        PROMPT_HTTP_TIMEOUT_MS,
        token(),
      )
      if (!('response' in result)) {
        throw new Error('Runtime service returned no response payload.')
      }
      const responseText = result.response
      if (responseText == null) {
        throw new Error('Runtime service returned null/undefined response.')
      }
      return String(responseText)
    },
    async listSessions(): Promise<any[]> {
      return (await getJson(baseUrl, '/api/sessions', READ_HTTP_TIMEOUT_MS, token())) as any[]
    },
    async listPendingApprovals(): Promise<RuntimeApprovalSummary[]> {
      return (await getJson(
        baseUrl,
        '/api/approvals',
        READ_HTTP_TIMEOUT_MS,
        token(),
      )) as RuntimeApprovalSummary[]
    },
    async settleApproval(id: string, approved: boolean): Promise<boolean> {
      const result = await postJson(
        baseUrl,
        '/api/approvals/settle',
        { id, approved },
        CONTROL_HTTP_TIMEOUT_MS,
        token(),
      )
      return Boolean(result.ok)
    },
    async setRemoteSafeMode(enabled: boolean): Promise<void> {
      await postJson(baseUrl, '/api/control/remote-safe', { enabled }, CONTROL_HTTP_TIMEOUT_MS, token())
    },
    async setSessionModel(source: TaskEnvelope['source'], sourceId: string, model: string): Promise<void> {
      await postJson(
        baseUrl,
        '/api/control/session-model',
        { source, sourceId, model },
        CONTROL_HTTP_TIMEOUT_MS,
        token(),
      )
    },
    async setSessionSandboxMode(
      source: TaskEnvelope['source'],
      sourceId: string,
      mode: 'default' | 'strict' | 'off',
    ): Promise<void> {
      await postJson(
        baseUrl,
        '/api/control/session-sandbox',
        { source, sourceId, mode },
        CONTROL_HTTP_TIMEOUT_MS,
        token(),
      )
    },
    async getSessionSubAgentKind(
      source: TaskEnvelope['source'],
      sourceId: string,
    ): Promise<SubAgentKind | null> {
      const query = new URLSearchParams({ source: String(source), sourceId })
      const result = (await getJson(
        baseUrl,
        `/api/control/session-sub-agent?${query.toString()}`,
        READ_HTTP_TIMEOUT_MS,
        token(),
      )) as { ok?: boolean; kind?: SubAgentKind | null }
      if (!result?.ok) {
        throw new Error('Runtime service returned no ok payload for session-sub-agent.')
      }
      return result.kind == null ? null : result.kind
    },
    async setSessionSubAgentKind(
      source: TaskEnvelope['source'],
      sourceId: string,
      kind: SubAgentKind | 'auto' | null | undefined,
    ): Promise<void> {
      const resolved = kind === undefined || kind === null || kind === 'auto' ? null : kind
      await postJson(
        baseUrl,
        '/api/control/session-sub-agent',
        {
          source,
          sourceId,
          kind: resolved === null ? 'auto' : resolved,
        },
        CONTROL_HTTP_TIMEOUT_MS,
        token(),
      )
    },
    async setActiveBrain(activeBrain: 'local' | 'gemini'): Promise<void> {
      await postJson(baseUrl, '/api/control/active-brain', { activeBrain }, CONTROL_HTTP_TIMEOUT_MS, token())
    },
    async setRouterMode(routerMode: 'always_gemini' | 'always_local' | 'smart'): Promise<void> {
      await postJson(baseUrl, '/api/control/router-mode', { routerMode }, CONTROL_HTTP_TIMEOUT_MS, token())
    },
    streamLogs(onEntry: (entry: LogEntry) => void): () => void {
      const url = new URL(baseUrl)
      let tok: string
      try {
        tok = token()
      } catch (e: any) {
        console.error('Log stream: missing runtime token:', e?.message ?? e)
        return () => {}
      }
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: '/api/logs',
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...authHeaders(tok),
        },
      }

      const req = http.request(options, (res) => {
        let buffer = ''
        res.on('data', (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6))
                onEntry(data)
              } catch {
                // Ignore parse errors
              }
            }
          }
        })
      })

      req.on('error', (error) => {
        // Only log if not explicitly destroyed
        if (!(req as any).destroyed) {
          console.error('Log stream request error:', error.message)
        }
      })

      req.end()

      return () => {
        req.destroy()
      }
    },
  }
}
