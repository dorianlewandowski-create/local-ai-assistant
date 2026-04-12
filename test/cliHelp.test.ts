import test from 'node:test'
import assert from 'node:assert/strict'
import { printApexCliHelp } from '../src/cliHelp'

test('printApexCliHelp includes files preview and safety hint', () => {
  const lines: string[] = []
  printApexCliHelp((line) => lines.push(line))
  const text = lines.join('\n')
  assert.match(text, /apex --version/)
  assert.match(text, /apex files preview/)
  assert.match(text, /files apply|preview only|no writes/i)
  assert.match(text, /\/help.*\/model.*\/agent/s)
})
