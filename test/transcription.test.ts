import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateAudioFileForTranscription } from '@apex/core'

test('audio validation rejects unsupported extensions', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-audio-unsupported-'))
  const filePath = path.join(tempDir, 'voice.bin')
  fs.writeFileSync(filePath, Buffer.from('test'))

  await assert.rejects(validateAudioFileForTranscription(filePath), /Unsupported audio format/)
})

test('audio validation accepts supported extensions under size limit', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-audio-ok-'))
  const filePath = path.join(tempDir, 'voice.ogg')
  fs.writeFileSync(filePath, Buffer.from('test'))

  await assert.doesNotReject(validateAudioFileForTranscription(filePath))
})
