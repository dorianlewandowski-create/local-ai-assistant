import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig, resolveConfigPath } from '@apex/core'
import { resolveCliCommand } from '../src/index'

test('config exposes default watcher directories', () => {
  const config = loadConfig({ env: {} })
  assert.ok(Array.isArray(config.watcher.directories))
  assert.ok(config.watcher.directories.length >= 2)
})

test('config exposes watcher extensions as lowercase set', () => {
  const config = loadConfig({ env: {} })
  assert.equal(config.watcher.extensions.has('.pdf'), true)
  assert.equal(config.watcher.extensions.has('.jpg'), true)
})

test('config loads apex.json and allows env overrides', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-config-'))
  fs.writeFileSync(
    path.join(tempDir, 'apex.json'),
    JSON.stringify({
      models: { chat: 'file-model' },
      watcher: { directories: ['~/Inbox'] },
      gateways: { telegram: { enabled: true } },
    }),
  )

  const config = loadConfig({
    cwd: tempDir,
    env: {
      OLLAMA_MODEL: 'env-model',
      APEX_WATCH_EXTENSIONS: '.pdf,.docx',
    },
  })

  assert.equal(config.models.chat, 'env-model')
  assert.equal(config.gateways.telegram.enabled, true)
  assert.equal(config.meta.configPath, path.join(tempDir, 'apex.json'))
  assert.equal(config.watcher.directories[0].endsWith(path.join('', 'Inbox')), true)
  assert.equal(config.watcher.extensions.has('.docx'), true)
})

test('resolveConfigPath respects APEX_CONFIG', () => {
  const resolved = resolveConfigPath('/tmp/project', { APEX_CONFIG: './config/apex.json' })
  assert.equal(resolved, '/tmp/project/config/apex.json')
})

test('APEX_WATCH_EXTENSIONS overrides watcher extensions from env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-config-extensions-'))
  fs.writeFileSync(path.join(tempDir, 'apex.json'), JSON.stringify({ models: { chat: 'x' } }))

  const config = loadConfig({
    cwd: tempDir,
    env: {
      APEX_WATCH_EXTENSIONS: '.md,.txt',
    },
  })

  assert.equal(config.watcher.extensions.has('.md'), true)
  assert.equal(config.watcher.extensions.has('.txt'), true)
})

test('cli resolves doctor command separately from runtime prompts', () => {
  assert.deepEqual(resolveCliCommand(['doctor']), { command: 'doctor', argv: [] })
  assert.deepEqual(resolveCliCommand(['runtime-info']), { command: 'runtime-info', argv: [] })
  assert.deepEqual(resolveCliCommand(['runtime-info', '--json']), {
    command: 'runtime-info',
    argv: ['--json'],
  })
  assert.deepEqual(resolveCliCommand(['open', 'Safari']), { command: 'run', argv: ['open', 'Safari'] })
  assert.deepEqual(resolveCliCommand(['help']), { command: 'help', argv: [] })
})
