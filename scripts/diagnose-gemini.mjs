#!/usr/bin/env node
/**
 * One-shot diagnostic: load Apex config the same way the app does (via @apex/core),
 * report whether a Gemini API key is present (never print the key), then call the
 * public REST API with a short prompt and a hard timeout.
 *
 * Usage (from repo root):
 *   node scripts/diagnose-gemini.mjs
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(root, '.env') })

// Resolve the same package the app uses (workspace symlink under node_modules/@apex/core).
const { loadConfig } = await import('@apex/core')

async function main() {
  let cfg
  try {
    cfg = await Promise.resolve(loadConfig())
  } catch (e) {
    console.error('loadConfig failed:', e?.message || e)
    process.exit(1)
  }

  const key = (cfg.apiKeys?.gemini ?? '').trim()
  console.log('[config] gemini key present:', Boolean(key))
  console.log('[config] gemini key length (chars):', key.length)
  console.log('[config] models.geminiModel:', cfg.models?.geminiModel ?? '(unset)')

  if (!key) {
    console.error(
      '[fetch] No API key in resolved config. Set GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY or Keychain apex/gemini.',
    )
    process.exit(2)
  }

  const model = process.argv[2] || 'gemini-2.5-pro'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: pong' }] }],
  })

  const timeoutMs = 25_000
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ac.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    console.error('[fetch] network error after', Date.now() - t0, 'ms:', e?.message || e)
    process.exit(3)
  }
  clearTimeout(timer)

  const elapsed = Date.now() - t0
  const text = await res.text()
  console.log('[fetch] HTTP', res.status, 'in', elapsed, 'ms')
  console.log('[fetch] body (first 800 chars):', text.slice(0, 800))
  process.exit(res.ok ? 0 : 4)
}

main().catch((e) => {
  console.error(e)
  process.exit(99)
})
