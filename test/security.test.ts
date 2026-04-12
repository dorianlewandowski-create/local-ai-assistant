import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod'
import { assessToolRisk } from '../src/security/policy'
import { approveTelegramUser, getPairingStorePath, isTelegramUserPaired } from '@apex/core'
import { resolveToolManifest } from '../src/tools/result'
import { Tool } from '../src/types'

function makeTool(name: string): Tool {
  const tool: Tool = {
    name,
    description: name,
    parameters: z.object({}).passthrough(),
    async execute() {
      return { success: true, message: 'ok' }
    },
  }

  return {
    ...tool,
    manifest: resolveToolManifest(tool),
  }
}

test('policy blocks destructive remote operations in remote-safe mode', () => {
  const decision = assessToolRisk(makeTool('empty_trash'), {}, 'telegram')
  assert.equal(decision.allowed, false)
  assert.equal(decision.permissionClass, 'destructive')
})

test('policy requires approval for local automation tools', () => {
  const decision = assessToolRisk(makeTool('open_app'), { appName: 'Safari' }, 'terminal')
  assert.equal(decision.allowed, true)
  assert.equal(decision.requiresAuthorization, true)
  assert.equal(decision.permissionClass, 'automation')
})

test('pairing store persists approved telegram users', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-pairing-'))
  const storePath = path.join(tempDir, 'pairings.json')
  process.env.APEX_PAIRING_STORE_PATH = storePath

  approveTelegramUser('12345')

  assert.equal(getPairingStorePath(), storePath)
  assert.equal(isTelegramUserPaired('12345'), true)

  delete process.env.APEX_PAIRING_STORE_PATH
})
