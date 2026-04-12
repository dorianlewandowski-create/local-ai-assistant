import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlackHelpText, buildSlackStatusText } from '../src/gateways/slackDiagnostics'
import { config } from '@apex/core'

test('slack status text contains key diagnostics', () => {
  const text = buildSlackStatusText(config)
  assert.match(text, /Apex Slack Status/)
  assert.match(text, /Mode: Socket Mode DM/)
  assert.match(text, /Native approvals: available in trusted DMs/)
})

test('slack help text includes command and setup guidance', () => {
  const text = buildSlackHelpText()
  assert.match(text, /\/status/)
  assert.match(text, /SLACK_BOT_TOKEN/)
  assert.match(text, /pairing approval/)
})
