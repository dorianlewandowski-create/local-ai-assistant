import type { ApexConfig } from '@apex/core'

export function buildSlackStatusText(config: ApexConfig): string {
  const allowlistCount = config.gateways.slack.allowFrom.length
  return [
    'Apex Slack Status',
    `Mode: Socket Mode DM`,
    `Slack enabled: ${config.gateways.slack.enabled ? 'yes' : 'no'}`,
    `Bot token configured: ${config.gateways.slack.botToken ? 'yes' : 'no'}`,
    `App token configured: ${config.gateways.slack.appToken ? 'yes' : 'no'}`,
    `Trusted DM allowlist entries: ${allowlistCount}`,
    `Unknown DMs: pairing required`,
    `Native approvals: available in trusted DMs`,
    `Channel support: not enabled yet`,
  ].join('\n')
}

export function buildSlackHelpText(): string {
  return [
    'Apex Slack',
    'Supported in trusted DMs:',
    '/status',
    '/screen',
    '/doctor',
    '/queue',
    '/sessions',
    '/memory',
    '/safe',
    '/sandbox',
    '/model',
    '/approvals',
    '/approve <id>',
    '/deny <id>',
    'Setup notes:',
    '- requires SLACK_BOT_TOKEN and SLACK_APP_TOKEN',
    '- unknown DMs use pairing approval',
    '- Slack channels/groups are not enabled yet',
  ].join('\n')
}
