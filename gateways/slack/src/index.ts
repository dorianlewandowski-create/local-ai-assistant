import { App } from '@slack/bolt'
import type { AuthorizationRequest } from '@apex/types'
import type { AuthorizationRequester } from '@apex/gateway-shared'
import {
  defaultGatewayLogger,
  GatewayProvider,
  type GatewayLogger,
  type RuntimeSubmissionClient,
} from '@apex/gateway-shared'
import {
  chunkRemoteResponse,
  formatRemoteAssistantText,
  NativeApprovalManager,
  type PendingApprovalSummary,
} from '@apex/gateway-shared'
import { captureScreenshot, cleanupScreenshot } from '@apex/gateway-screenshot'
import {
  config as defaultConfig,
  getOrCreatePairingCode,
  isChannelSubjectApproved,
  PairingRateLimitedError,
  type ApexConfig,
} from '@apex/core'
import fs from 'fs'
import { buildSlackHelpText, buildSlackStatusText } from './slackDiagnosticsShim'

// Keep diagnostics shimmed until config extraction is complete.
// (We provide a local module that matches the previous exports.)

export class SlackGateway extends GatewayProvider implements AuthorizationRequester {
  private app: App | null = null
  private readonly approvals = new NativeApprovalManager()
  private readonly config: ApexConfig
  private readonly log: GatewayLogger
  private readonly energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }

  constructor(
    client: RuntimeSubmissionClient,
    options: {
      config?: ApexConfig
      logger?: GatewayLogger
      energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
    } = {},
  ) {
    super('slack', client)
    this.config = options.config ?? defaultConfig
    this.log = options.logger ?? defaultGatewayLogger
    this.energyImpact = options.energyImpact
  }

  async start(): Promise<void> {
    if (!this.config.gateways.slack.enabled && !this.config.gateways.slack.botToken) {
      this.log.debug('Slack disabled')
      return
    }

    if (!this.config.gateways.slack.botToken || !this.config.gateways.slack.appToken) {
      this.log.warn('Slack inbound requires SLACK_BOT_TOKEN and SLACK_APP_TOKEN. Slack remains disabled.')
      return
    }

    this.app = new App({
      token: this.config.gateways.slack.botToken,
      appToken: this.config.gateways.slack.appToken,
      socketMode: true,
    })

    this.app.event('message', async ({ event, say }) => {
      const message = event as any
      if (message.channel_type !== 'im' || !message.user || !message.text) {
        return
      }

      const text = String(message.text).trim()
      if (!text) {
        return
      }

      if (!this.isAuthorized(message.user)) {
        try {
          const { code } = getOrCreatePairingCode('slack', message.user)
          await say(
            `Apex Slack is not paired for this DM yet. Pairing code: ${code}. Approve locally with: apex pairing approve slack ${code}`,
          )
        } catch (e) {
          if (e instanceof PairingRateLimitedError) {
            await say('Too many new pairing attempts. Please try again later.')
            return
          }
          throw e
        }
        return
      }

      if (text === '/status') {
        await this.sendResponse(message.channel, buildSlackStatusText(this.config))
        return
      }

      if (text === '/screen') {
        await this.sendScreen(message.channel)
        return
      }

      if (text.startsWith('/approve ')) {
        const approvalId = text.split(/\s+/, 2)[1]
        await this.sendResponse(
          message.channel,
          this.approvals.settle(approvalId, true)
            ? `Approved ${approvalId}.`
            : `Approval ${approvalId} was not found.`,
        )
        return
      }

      if (text.startsWith('/deny ')) {
        const approvalId = text.split(/\s+/, 2)[1]
        await this.sendResponse(
          message.channel,
          this.approvals.settle(approvalId, false)
            ? `Denied ${approvalId}.`
            : `Approval ${approvalId} was not found.`,
        )
        return
      }

      if (text === '/help' || text === '/start') {
        await this.sendResponse(message.channel, buildSlackHelpText())
        return
      }

      if (text.startsWith('/')) {
        const response = await this.dispatch(text, message.channel, {
          slackUserId: message.user,
          slackChannelId: message.channel,
        })

        await this.sendResponse(message.channel, response || 'Unknown command. Use /help.')
        return
      }

      try {
        const response = await this.dispatch(text, message.channel, {
          slackUserId: message.user,
          slackChannelId: message.channel,
        })
        if (response) {
          await this.sendResponse(message.channel, response)
          this.log.chat?.('assistant', `[Slack] ${response}`)
        }
      } catch (error: any) {
        this.log.error(`Slack dispatch failed: ${error.message}`)
        await this.sendResponse(message.channel, 'Apex could not queue that request right now.')
      }
    })

    await this.app.start()
    this.log.system('Slack Socket Mode DM support initialized')
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack client is not initialized.')
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3500)) {
      await this.app.client.chat.postMessage({
        channel: to,
        text: chunk,
      })
    }
  }

  async stop(): Promise<void> {
    this.approvals.stop()
    await this.app?.stop()
    this.app = null
  }

  getPendingApprovalCount(): number {
    return this.approvals.getPendingCount()
  }

  listPendingApprovals(): PendingApprovalSummary[] {
    return this.approvals.listPending()
  }

  settleApproval(id: string, approved: boolean): boolean {
    return this.approvals.settle(id, approved)
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.app || !request.sourceId) {
      throw new Error('Slack authorization requested but app is not initialized or sourceId is missing.')
    }

    return this.approvals.request(request, async (pendingRequest: AuthorizationRequest) => {
      await this.sendResponse(
        request.sourceId!,
        [
          `Approval required: ${pendingRequest.permissionClass.toUpperCase()}`,
          `ID: ${pendingRequest.id}`,
          `Tool: ${pendingRequest.toolName}`,
          `Reason: ${pendingRequest.reason}`,
          `Reply with /approve ${pendingRequest.id} or /deny ${pendingRequest.id}`,
        ].join('\n'),
      )
    })
  }

  private isAuthorized(userId: string): boolean {
    return isChannelSubjectApproved('slack', userId, this.config.gateways.slack.allowFrom)
  }

  private async sendScreen(channel: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack app is not initialized.')
    }

    const imagePath = '/tmp/apex-slack-screen.png'
    try {
      await captureScreenshot(imagePath, { energyImpact: this.energyImpact })
      const fileContent = fs.readFileSync(imagePath)
      await this.app.client.files.uploadV2({
        channel_id: channel,
        filename: 'apex-screen.png',
        title: 'Current desktop snapshot',
        file: fileContent,
      })
    } finally {
      await cleanupScreenshot(imagePath)
    }
  }
}

export function createSlackGateway(
  client: RuntimeSubmissionClient,
  options: {
    config?: ApexConfig
    logger?: GatewayLogger
    energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
  } = {},
) {
  return new SlackGateway(client, options)
}
