import http from 'http'
import type { SubAgentKind, TaskEnvelope } from '@apex/types'
import { config } from '@apex/core'
import { RuntimeApi } from './api'
import { emitDebugLog } from './debugIngest'
import { timingSafeEqualString } from './runtimeServiceToken'
import { parseRuntimePromptBody } from './runtimePromptBody'
import { logger } from '../utils/logger'

export type RuntimeServiceServerOptions = {
  /** Shared secret for all non-health HTTP routes (Bearer or X-Apex-Token). */
  expectedToken: string
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function extractRuntimeToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization?.trim()
  if (auth && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim()
    return t || null
  }
  const x = req.headers['x-apex-token']
  const v = Array.isArray(x) ? x[0] : x
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function unauthorized(res: http.ServerResponse) {
  sendJson(res, 401, {
    ok: false,
    error:
      'Unauthorized: missing or invalid runtime token. Use Authorization: Bearer <token> or X-Apex-Token. Token file: ~/.apex/runtime.token (or APEX_RUNTIME_TOKEN).',
  })
}

export function createRuntimeServiceServer(api: RuntimeApi, options: RuntimeServiceServerOptions) {
  const { expectedToken } = options

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/'

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('ok')
      return
    }

    const token = extractRuntimeToken(req)
    if (!token || !timingSafeEqualString(token, expectedToken)) {
      logger.warn('Runtime HTTP: rejected request (missing or invalid token)')
      unauthorized(res)
      return
    }

    if (req.method === 'GET' && url === '/api/logs') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      const listener = (entry: any) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`)
      }

      api.onLog(listener)

      req.on('close', () => {
        api.offLog(listener)
      })
      return
    }

    if (req.method === 'GET' && url === '/api/status') {
      const body = await api.getStatusSnapshot()
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      })
      res.end(JSON.stringify(body))
      return
    }

    if (req.method === 'GET' && url === '/api/sessions') {
      const body = api.listSessions(20)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
      return
    }

    if (req.method === 'GET' && url === '/api/approvals') {
      const body = api.listPendingApprovals()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
      return
    }

    if (req.method === 'POST' && url === '/api/prompt') {
      const body = await readJsonBody(req)
      const correlationId =
        typeof body?.metadata?.correlationId === 'string' ? body.metadata.correlationId : undefined
      emitDebugLog({
        sessionId: '35112d',
        runId: 'pre-fix',
        hypothesisId: 'H2',
        location: 'src/runtime/serviceServer.ts:/api/prompt',
        message: 'Runtime received /api/prompt',
        correlationId,
        data: {
          source: String(body.source || ''),
          sourceId: String(body.sourceId || ''),
          len: String(body.prompt || '').length,
          correlationId,
        },
        timestamp: Date.now(),
      })

      const parsed = parseRuntimePromptBody(body)
      if (!parsed.ok) {
        sendJson(res, 400, { ok: false, error: parsed.error })
        return
      }

      const responseText = await api.submitPrompt(parsed.value)
      if (typeof responseText !== 'string') {
        emitDebugLog({
          sessionId: '35112d',
          runId: 'pre-fix',
          hypothesisId: 'H2',
          location: 'src/runtime/serviceServer.ts:/api/prompt',
          message: 'Runtime non-string response',
          correlationId,
          data: { type: typeof responseText, correlationId },
          timestamp: Date.now(),
        })
        sendJson(res, 500, { ok: false, error: 'Runtime returned non-string response.' })
        return
      }
      emitDebugLog({
        sessionId: '35112d',
        runId: 'pre-fix',
        hypothesisId: 'H2',
        location: 'src/runtime/serviceServer.ts:/api/prompt',
        message: 'Runtime returning response',
        correlationId,
        data: { trimLen: String(responseText).trim().length, correlationId },
        timestamp: Date.now(),
      })
      sendJson(res, 200, { ok: true, response: responseText })
      return
    }

    if (req.method === 'POST' && url === '/api/approvals/settle') {
      const body = await readJsonBody(req)
      const settled = api.settleApproval(body.id, Boolean(body.approved))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: settled }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/remote-safe') {
      const body = await readJsonBody(req)
      api.setRemoteSafeMode(Boolean(body.enabled))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, enabled: Boolean(body.enabled) }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/session-model') {
      const body = await readJsonBody(req)
      api.setSessionModelByKey(body.source, body.sourceId, body.model)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/session-sandbox') {
      const body = await readJsonBody(req)
      api.setSessionSandboxModeByKey(body.source, body.sourceId, body.mode)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method === 'GET' && url.startsWith('/api/control/session-sub-agent')) {
      const parsedUrl = new URL(url, 'http://127.0.0.1')
      if (parsedUrl.pathname !== '/api/control/session-sub-agent') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const source = parsedUrl.searchParams.get('source')
      const sourceId = parsedUrl.searchParams.get('sourceId')
      if (!source || sourceId == null || sourceId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'Missing source or sourceId query parameters.' }))
        return
      }
      const kind = api.getSessionSubAgentKindByKey(source as TaskEnvelope['source'], sourceId)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, kind: kind ?? null }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/session-sub-agent') {
      const body = await readJsonBody(req)
      if (body?.source == null || body?.sourceId == null || body.sourceId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'Missing source or sourceId.' }))
        return
      }
      const raw = body?.kind
      let resolved: SubAgentKind | undefined
      if (raw === undefined || raw === null || raw === 'auto') {
        resolved = undefined
      } else if (raw === 'researcher' || raw === 'coder' || raw === 'system') {
        resolved = raw
      } else {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify({
            ok: false,
            error: 'Invalid kind: expected researcher, coder, system, auto, or null.',
          }),
        )
        return
      }
      api.setSessionSubAgentKindByKey(body.source as TaskEnvelope['source'], body.sourceId, resolved)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, kind: resolved ?? null }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/active-brain') {
      const body = await readJsonBody(req)
      const activeBrain = body.activeBrain === 'gemini' ? 'gemini' : 'local'
      api.setActiveBrain(activeBrain)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, activeBrain }))
      return
    }

    if (req.method === 'POST' && url === '/api/control/router-mode') {
      const body = await readJsonBody(req)
      const mode =
        body.routerMode === 'always_gemini' || body.routerMode === 'always_local' ? body.routerMode : 'smart'
      api.setRouterMode(mode)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, routerMode: mode }))
      return
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  })

  return {
    async start(): Promise<void> {
      if (!config.runtimeService.enabled) {
        return
      }

      await new Promise<void>((resolve, reject) => {
        const onError = (error: any) => {
          if (error?.code === 'EADDRINUSE') {
            // eslint-disable-next-line no-console
            console.error(`Port ${config.runtimeService.port} is in use. Please kill the existing process.`)
          }
          reject(error)
        }
        server.once('error', onError)
        server.listen(config.runtimeService.port, '127.0.0.1', () => {
          server.off('error', onError)
          resolve()
        })
      })
    },
    async stop(): Promise<void> {
      if (!server.listening) {
        return
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    getPort(): number {
      return config.runtimeService.port
    },
  }
}
