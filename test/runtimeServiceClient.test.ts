import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeServiceClient } from '../src/runtime/serviceClient';

test('runtime service client submits prompts through prompt endpoint', async () => {
  const originalFetch = global.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, response: 'service-response' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = createRuntimeServiceClient('http://127.0.0.1:9999');
    const response = await client.submitPrompt('terminal', 'local-console', 'hello');

    assert.equal(response, 'service-response');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://127.0.0.1:9999/api/prompt');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.match(String(calls[0]?.init?.body), /"prompt":"hello"/);
  } finally {
    global.fetch = originalFetch;
  }
});
