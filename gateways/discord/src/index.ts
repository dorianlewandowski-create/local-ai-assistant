import { Client, GatewayIntentBits, Partials, type Channel, type Message } from 'discord.js'
import type { AuthorizationRequest } from '@apex/types'
import type { AuthorizationRequester } from '@apex/gateway-shared'
import {
  chunkRemoteResponse,
  defaultGatewayLogger,
  formatRemoteAssistantText,
  GatewayProvider,
  NativeApprovalManager,
  type GatewayLogger,
  type PendingApprovalSummary,
  type RuntimeSubmissionClient,
} from '@apex/gateway-shared'
import {
  config as defaultConfig,
  getOrCreatePairingCode,
  isChannelSubjectApproved,
  PairingRateLimitedError,
  type ApexConfig,
} from '@apex/core'

function buildDiscordHelpText(): string {
  return [
    'Apex Discord (DM only)',
    '',
    '/help — show this message',
    '/status — show Apex version and runtime label',
    'Pairing: request a code in DM, then approve locally:',
    '  apex pairing approve discord <CODE>',
    '/approve <id> and /deny <id> — respond to tool approval prompts',
  ].join('\n')
}

export class DiscordGateway extends GatewayProvider implements AuthorizationRequester {
  /** discord.js client (not the runtime HTTP submission client — that is `this.client` on the base class). */
  private discord: Client | null = null
  private readonly approvals = new NativeApprovalManager()
  private readonly config: ApexConfig
  private readonly log: GatewayLogger

  constructor(
    client: RuntimeSubmissionClient,
    options: {
      config?: ApexConfig
      logger?: GatewayLogger
    } = {},
  ) {
    super('discord', client)
    this.config = options.config ?? defaultConfig
    this.log = options.logger ?? defaultGatewayLogger
  }

  async start(): Promise<void> {
    if (!this.config.gateways.discord.enabled) {
      this.log.debug('Discord disabled')
      return
    }

    if (!this.config.gateways.discord.botToken?.trim()) {
      this.log.warn('Discord enabled but DISCORD_BOT_TOKEN is empty. Discord remains disabled.')
      return
    }

    this.discord = new Client({
      intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel],
    })

    this.discord.once('ready', () => {
      this.log.system(`Discord gateway ready as ${this.discord?.user?.tag ?? 'unknown'}`)
    })

    this.discord.on('messageCreate', async (message: Message) => {
      try {
        await this.handleMessage(message)
      } catch (error: any) {
        this.log.error(`Discord message handler failed: ${error?.message ?? String(error)}`)
      }
    })

    await this.discord.login(this.config.gateways.discord.botToken.trim())
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.discord || message.author.bot) {
      return
    }

    if (!message.channel.isDMBased()) {
      return
    }

    const text = String(message.content ?? '').trim()
    if (!text) {
      return
    }

    const userId = message.author.id
    if (!this.isAuthorized(userId)) {
      try {
        const { code } = getOrCreatePairingCode('discord', userId)
        await this.sendToChannel(
          message.channel,
          [
            'Apex Discord is not paired for your account yet.',
            `Pairing code: ${code}`,
            'Approve locally with:',
            `  apex pairing approve discord ${code}`,
          ].join('\n'),
        )
      } catch (e) {
        if (e instanceof PairingRateLimitedError) {
          await this.sendToChannel(message.channel, 'Too many new pairing attempts. Please try again later.')
          return
        }
        throw e
      }
      return
    }

    const channelId = message.channel.id

    if (text === '/help' || text === '/start') {
      await this.sendToChannel(message.channel, buildDiscordHelpText())
      return
    }

    if (text === '/status') {
      await this.sendToChannel(
        message.channel,
        `Apex ${this.config.app.version} · ${this.config.app.statusAiLabel}`,
      )
      return
    }

    if (text.startsWith('/approve ')) {
      const approvalId = text.split(/\s+/, 2)[1]
      await this.sendToChannel(
        message.channel,
        this.approvals.settle(approvalId, true)
          ? `Approved ${approvalId}.`
          : `Approval ${approvalId} was not found.`,
      )
      return
    }

    if (text.startsWith('/deny ')) {
      const approvalId = text.split(/\s+/, 2)[1]
      await this.sendToChannel(
        message.channel,
        this.approvals.settle(approvalId, false)
          ? `Denied ${approvalId}.`
          : `Approval ${approvalId} was not found.`,
      )
      return
    }

    if (text.startsWith('/')) {
      await this.sendToChannel(message.channel, 'Unknown command. Use /help.')
      return
    }

    const response = await this.dispatch(text, channelId, { discordUserId: userId })
    await this.sendToChannel(message.channel, response)
    this.log.chat?.('assistant', `[Discord] ${response}`)
  }

  private isAuthorized(userId: string): boolean {
    return isChannelSubjectApproved('discord', userId, this.config.gateways.discord.allowFrom)
  }

  private async sendToChannel(channel: Channel, text: string): Promise<void> {
    if (!channel.isTextBased()) {
      throw new Error('Discord channel is not text-capable.')
    }

    const sendable = channel as { send: (content: string) => Promise<unknown> }
    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 1900)) {
      await sendable.send(chunk)
    }
  }

  async sendResponse(channelId: string, text: string): Promise<void> {
    if (!this.discord) {
      throw new Error('Discord client is not initialized.')
    }

    const channel = await this.discord.channels.fetch(channelId)
    if (!channel) {
      throw new Error(`Discord channel ${channelId} not found.`)
    }

    await this.sendToChannel(channel, text)
  }

  async stop(): Promise<void> {
    this.approvals.stop()
    await this.discord?.destroy()
    this.discord = null
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
    if (!this.discord || !request.sourceId) {
      throw new Error('Discord authorization requested but client is not initialized or sourceId is missing.')
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
}

export function createDiscordGateway(
  client: RuntimeSubmissionClient,
  options: {
    config?: ApexConfig
    logger?: GatewayLogger
  } = {},
) {
  return new DiscordGateway(client, options)
}
