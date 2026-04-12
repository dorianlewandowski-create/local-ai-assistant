import test from 'node:test'
import assert from 'node:assert/strict'
import { runUpdateHelp } from '../src/update'

test('runUpdateHelp mentions build, launchd, runtime-info, and trust doc', async () => {
  const lines: string[] = []
  await runUpdateHelp((l) => lines.push(l))
  const text = lines.join('\n')
  assert.match(text, /npm run build/)
  assert.match(text, /launchd:install/)
  assert.match(text, /apex runtime-info/)
  assert.match(text, /OPERATOR_TRUST/)
})
