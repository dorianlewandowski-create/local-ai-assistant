import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import path from 'path'
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
import { getGatewayStatusLines } from '@apex/gateway-shared'
import {
  config as defaultConfig,
  getOrCreatePairingCode,
  PairingRateLimitedError,
  type ApexConfig,
} from '@apex/core'
import { isWhatsAppMessageAuthorized } from './policy'
import { captureScreenshot, cleanupScreenshot } from '@apex/gateway-screenshot'
import {
  cleanupTempFile,
  getTranscriptionSetupHint,
  transcribeAudioFile,
  writeTempMediaFile,
} from '@apex/core'

function getExecutablePath(executablePathOverride?: string): string | undefined {
  const candidates = [
    executablePathOverride,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => fs.existsSync(candidate))
}

export class WhatsAppGateway extends GatewayProvider implements AuthorizationRequester {
  private waClient: Client | null = null
  private readonly approvals = new NativeApprovalManager()
  private readonly config: ApexConfig
  private readonly log: GatewayLogger
  private readonly energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
  private readonly transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>

  constructor(
    client: RuntimeSubmissionClient,
    options: {
      config?: ApexConfig
      logger?: GatewayLogger
      energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
      transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>
    } = {},
  ) {
    super('whatsapp', client)
    this.config = options.config ?? defaultConfig
    this.log = options.logger ?? defaultGatewayLogger
    this.energyImpact = options.energyImpact
    this.transcriber = options.transcriber
  }

  async start(): Promise<void> {
    if (!this.config.gateways.whatsapp.enabled) {
      this.log.debug('WhatsApp disabled')
      return
    }

    const executablePath = getExecutablePath(this.config.gateways.whatsapp.executablePath)
    this.log.system('WhatsApp initializing client')
    if (executablePath) {
      this.log.system(`WhatsApp using browser: ${executablePath}`)
    } else {
      this.log.warn(
        'WhatsApp enabled but no Chrome/Chromium executable was found; Puppeteer may fail to launch',
      )
    }

    this.waClient = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
        executablePath,
      },
    })

    this.waClient.on('qr', (qr) => {
      this.log.system('WhatsApp QR code received. Scan it with WhatsApp.')
      qrcode.generate(qr, { small: true })
    })

    this.waClient.on('ready', () => {
      this.log.system('WhatsApp client ready')
    })

    this.waClient.on('message', async (message) => {
      const text = message.body.trim()
      const authorId = message.author || message.from
      if (!this.isAuthorized(message.from, authorId)) {
        if (message.from.endsWith('@g.us')) {
          void message.reply(
            'Apex is not enabled for this group sender yet. Add the sender to APEX_WHATSAPP_GROUP_ALLOW_FROM or change APEX_WHATSAPP_GROUP_POLICY.',
          )
          return
        }

        try {
          const { code } = getOrCreatePairingCode('whatsapp', message.from)
          void message.reply(
            `Apex WhatsApp is not paired for this chat yet. Pairing code: ${code}. Approve locally with: apex pairing approve whatsapp ${code}`,
          )
        } catch (e) {
          if (e instanceof PairingRateLimitedError) {
            void message.reply('Too many new pairing attempts. Please try again later.')
            return
          }
          throw e
        }
        return
      }

      if (text === '/status') {
        void this.sendStatus(message.from)
        return
      }

      if (text === '/screen') {
        void this.sendScreen(message.from)
        return
      }

      if (text.startsWith('/approve ')) {
        const approvalId = text.split(/\s+/, 2)[1]
        const settled = this.approvals.settle(approvalId, true)
        void message.reply(settled ? `Approved ${approvalId}.` : `Approval ${approvalId} was not found.`)
        return
      }

      if (text.startsWith('/deny ')) {
        const approvalId = text.split(/\s+/, 2)[1]
        const settled = this.approvals.settle(approvalId, false)
        void message.reply(settled ? `Denied ${approvalId}.` : `Approval ${approvalId} was not found.`)
        return
      }

      if (text === '/help' || text === '/start') {
        void message.reply(
          'Apex WhatsApp\nUse /status, /screen, /doctor, /queue, /sessions, /memory, /safe, /sandbox, /model, or send a task.',
        )
        return
      }

      if (text.startsWith('/')) {
        try {
          const response = await this.dispatch(text, message.from)
          if (!response) {
            void message.reply('Unknown command. Use /help.')
            return
          }
          await this.sendResponse(message.from, response)
          this.log.chat?.('assistant', `[WhatsApp] ${response}`)
        } catch (error: any) {
          this.log.error(`WhatsApp admin command failed: ${error.message}`)
          void message.reply('Apex could not process that command.')
        }
        return
      }

      if (message.hasMedia) {
        void this.handleMediaMessage(message)
        return
      }

      try {
        const response = await this.dispatch(message.body, message.from, {
          from: message.from,
          timestamp: message.timestamp,
        })
        if (response) {
          await this.sendResponse(message.from, response)
          this.log.chat?.('assistant', `[WhatsApp] ${response}`)
        }
      } catch (error: any) {
        this.log.error(`WhatsApp dispatch failed: ${error.message}`)
        void message.reply('Apex could not queue that request right now.')
      }
    })

    await this.waClient.initialize()
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.waClient) {
      throw new Error('WhatsApp client is not initialized.')
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3000)) {
      await this.waClient.sendMessage(to, chunk)
    }
  }

  private async sendStatus(to: string): Promise<void> {
    const lines = await getGatewayStatusLines(
      async () => 'Unavailable',
      async () => 'Unavailable',
    )
    await this.sendResponse(to, lines.join('\n'))
  }

  private async sendScreen(to: string): Promise<void> {
    if (!this.waClient) {
      throw new Error('WhatsApp client is not initialized.')
    }

    const imagePath = '/tmp/apex-whatsapp-screen.png'
    try {
      await captureScreenshot(imagePath, { energyImpact: this.energyImpact })
      const media = MessageMedia.fromFilePath(imagePath)
      await this.waClient.sendMessage(to, media, { caption: 'Current desktop snapshot' })
    } finally {
      await cleanupScreenshot(imagePath)
    }
  }

  private async handleMediaMessage(message: any): Promise<void> {
    let filePath: string | undefined
    try {
      const media = await message.downloadMedia()
      if (!media?.data) {
        await message.reply('Apex could not download that media.')
        return
      }

      const buffer = Buffer.from(media.data, 'base64')
      if (buffer.byteLength > this.config.media.maxTelegramFileBytes) {
        await message.reply(
          `Apex media limit exceeded. Max size is ${this.config.media.maxTelegramFileBytes} bytes.`,
        )
        return
      }

      const extension = this.getMediaExtension(media.mimetype, media.filename, message.type)
      filePath = await writeTempMediaFile('apex-whatsapp-media', extension, buffer)

      if (message.type === 'audio' || message.type === 'ptt') {
        try {
          if (!this.transcriber) {
            throw new Error('Audio transcription is unavailable (no transcriber configured).')
          }
          const transcript = await transcribeAudioFile(filePath, { transcribe: this.transcriber })
          try {
            const response = await this.dispatch(
              `The user sent a WhatsApp voice note. Transcript: ${transcript}`,
              message.from,
              {
                from: message.from,
                author: message.author,
                timestamp: message.timestamp,
                whatsappMediaType: message.type,
              },
            )
            if (response) {
              await this.sendResponse(message.from, response)
              this.log.chat?.('assistant', `[WhatsApp] ${response}`)
            }
          } finally {
            await cleanupTempFile(filePath)
          }
          return
        } catch (error: any) {
          await cleanupTempFile(filePath)
          await message.reply(
            `Apex received the voice note, but transcription is unavailable: ${error.message} ${getTranscriptionSetupHint()}`,
          )
          return
        }
      }

      const prompt = this.buildMediaPrompt(message.type, filePath)
      if (!prompt) {
        await cleanupTempFile(filePath)
        await message.reply('Apex does not support that WhatsApp media type yet.')
        return
      }

      try {
        const response = await this.dispatch(prompt, message.from, {
          from: message.from,
          author: message.author,
          timestamp: message.timestamp,
          whatsappMediaType: message.type,
          downloadedFilePath: filePath,
        })
        if (response) {
          await this.sendResponse(message.from, response)
          this.log.chat?.('assistant', `[WhatsApp] ${response}`)
        }
      } finally {
        await cleanupTempFile(filePath)
      }
    } catch (error: any) {
      await cleanupTempFile(filePath)
      this.log.error(`WhatsApp media handling failed: ${error.message}`)
      await message.reply(`Apex could not process that media: ${error.message}`)
    }
  }

  private buildMediaPrompt(messageType: string, filePath: string): string | null {
    if (messageType === 'image') {
      return `Analyze this WhatsApp image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`
    }

    if (messageType === 'document') {
      const extension = path.extname(filePath).toLowerCase()
      if (extension === '.pdf') {
        return `Read this WhatsApp PDF immediately using read_pdf_content with path "${filePath}". Summarize the important contents and recommend the next best action.`
      }

      if (['.jpg', '.jpeg', '.png'].includes(extension)) {
        return `Analyze this WhatsApp image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`
      }

      return `Read this WhatsApp file immediately using read_text_file with path "${filePath}". Summarize the important contents and recommend the next best action.`
    }

    return null
  }

  private getMediaExtension(
    mimeType: string | undefined,
    filename: string | undefined,
    messageType: string,
  ): string {
    const byFilename = filename ? path.extname(filename).toLowerCase() : ''
    if (byFilename) {
      return byFilename
    }

    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg'
      case 'image/png':
        return '.png'
      case 'application/pdf':
        return '.pdf'
      case 'audio/ogg; codecs=opus':
      case 'audio/ogg':
        return '.ogg'
      case 'audio/mpeg':
        return '.mp3'
      default:
        return messageType === 'audio' || messageType === 'ptt' ? '.ogg' : '.bin'
    }
  }

  private isAuthorized(chatId: string, authorId: string): boolean {
    return isWhatsAppMessageAuthorized(chatId, authorId, this.config.gateways.whatsapp)
  }

  async stop(): Promise<void> {
    this.approvals.stop()
    await this.waClient?.destroy()
    this.waClient = null
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
    if (!this.waClient || !request.sourceId) {
      throw new Error(
        'WhatsApp authorization requested but client is not initialized or sourceId is missing.',
      )
    }

    return this.approvals.request(request, async (pendingRequest) => {
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

export function createWhatsAppGateway(
  client: RuntimeSubmissionClient,
  options: {
    config?: ApexConfig
    logger?: GatewayLogger
    energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
    transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>
  } = {},
) {
  return new WhatsAppGateway(client, options)
}
