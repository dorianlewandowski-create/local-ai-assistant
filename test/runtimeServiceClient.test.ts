import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeServiceClient } from '../src/runtime/serviceClient'

test('runtime service client submits prompts through prompt endpoint', async () => {
  const originalFetch = global.fetch
  const originalToken = process.env.APEX_RUNTIME_TOKEN
  process.env.APEX_RUNTIME_TOKEN = 'test-runtime-token'
  const calls: Array<{ url: string; init?: RequestInit }> = []

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, response: 'service-response' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const client = createRuntimeServiceClient('http://127.0.0.1:9999')
    const response = await client.submitPrompt('terminal', 'local-console', 'hello')

    assert.equal(response, 'service-response')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'http://127.0.0.1:9999/api/prompt')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.match(String(calls[0]?.init?.body), /"prompt":"hello"/)
    const headers = calls[0]?.init?.headers as Record<string, string> | Headers | undefined
    const auth =
      headers instanceof Headers ? headers.get('Authorization') : headers?.['Authorization']
    assert.equal(auth, 'Bearer test-runtime-token')
  } finally {
    global.fetch = originalFetch
    if (originalToken === undefined) delete process.env.APEX_RUNTIME_TOKEN
    else process.env.APEX_RUNTIME_TOKEN = originalToken
  }
})

test('runtime service client reads session sub-agent via GET', async () => {
  const originalFetch = global.fetch
  const originalToken = process.env.APEX_RUNTIME_TOKEN
  process.env.APEX_RUNTIME_TOKEN = 'test-runtime-token'
  const calls: Array<{ url: string; init?: RequestInit }> = []

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, kind: 'researcher' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const client = createRuntimeServiceClient('http://127.0.0.1:9999')
    const kind = await client.getSessionSubAgentKind('terminal', 'local-console')

    assert.equal(kind, 'researcher')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.init?.method ?? 'GET', 'GET')
    assert.match(calls[0]?.url ?? '', /\/api\/control\/session-sub-agent\?/)
    assert.match(calls[0]?.url ?? '', /source=terminal/)
    assert.match(calls[0]?.url ?? '', /sourceId=local-console/)
    const headers = calls[0]?.init?.headers as Record<string, string> | Headers | undefined
    const auth =
      headers instanceof Headers ? headers.get('Authorization') : headers?.['Authorization']
    assert.equal(auth, 'Bearer test-runtime-token')
  } finally {
    global.fetch = originalFetch
    if (originalToken === undefined) delete process.env.APEX_RUNTIME_TOKEN
    else process.env.APEX_RUNTIME_TOKEN = originalToken
  }
})

test('runtime service client sets session sub-agent via POST', async () => {
  const originalFetch = global.fetch
  const originalToken = process.env.APEX_RUNTIME_TOKEN
  process.env.APEX_RUNTIME_TOKEN = 'test-runtime-token'
  const calls: Array<{ url: string; init?: RequestInit }> = []

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, kind: 'coder' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const client = createRuntimeServiceClient('http://127.0.0.1:9999')
    await client.setSessionSubAgentKind('terminal', 'local-console', 'coder')

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'http://127.0.0.1:9999/api/control/session-sub-agent')
    assert.equal(calls[0]?.init?.method, 'POST')
    assert.match(String(calls[0]?.init?.body), /"kind":"coder"/)
    const headers = calls[0]?.init?.headers as Record<string, string> | Headers | undefined
    const auth =
      headers instanceof Headers ? headers.get('Authorization') : headers?.['Authorization']
    assert.equal(auth, 'Bearer test-runtime-token')
  } finally {
    global.fetch = originalFetch
    if (originalToken === undefined) delete process.env.APEX_RUNTIME_TOKEN
    else process.env.APEX_RUNTIME_TOKEN = originalToken
  }
})

test('runtime service client throws when token is missing', async () => {
  const originalToken = process.env.APEX_RUNTIME_TOKEN
  const originalFile = process.env.APEX_RUNTIME_TOKEN_FILE
  delete process.env.APEX_RUNTIME_TOKEN
  delete process.env.APEX_RUNTIME_TOKEN_FILE
  try {
    const client = createRuntimeServiceClient('http://127.0.0.1:9999')
    await assert.rejects(() => client.getStatusSnapshot(), /Missing Apex runtime auth token/)
  } finally {
    if (originalToken === undefined) delete process.env.APEX_RUNTIME_TOKEN
    else process.env.APEX_RUNTIME_TOKEN = originalToken
    if (originalFile === undefined) delete process.env.APEX_RUNTIME_TOKEN_FILE
    else process.env.APEX_RUNTIME_TOKEN_FILE = originalFile
  }
})
