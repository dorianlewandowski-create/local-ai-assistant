import { Input, Markup, Telegraf } from 'telegraf'
import type { AuthorizationRequest } from '@apex/types'
import type { AuthorizationRequester } from '@apex/gateway-shared'
import {
  defaultGatewayLogger,
  GatewayProvider,
  type GatewayLogger,
  type RuntimeSubmissionClient,
} from '@apex/gateway-shared'
import {
  approveTelegramUser,
  config as defaultConfig,
  generatePairingCode,
  isTelegramUserPaired,
  PairingRateLimitedError,
  pairingRateLimitKey,
  recordNewPairingCode,
  writeSecurityAudit,
  type ApexConfig,
} from '@apex/core'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  cleanupTempFile,
  getTranscriptionSetupHint,
  transcribeAudioFile,
  writeTempMediaFile,
} from '@apex/core'
import { chunkRemoteResponse, formatRemoteAssistantText } from '@apex/gateway-shared'
import { getGatewayStatusLines } from '@apex/gateway-shared'
import { captureScreenshot, cleanupScreenshot } from '@apex/gateway-screenshot'
import type { PendingApprovalSummary } from '@apex/gateway-shared'

function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

const TELEGRAM_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png'])
const execFileAsync = promisify(execFile)

interface PendingAuthorization {
  request: AuthorizationRequest
  resolve: (approved: boolean) => void
  expiresAt: number
  timeout: NodeJS.Timeout
}

interface PendingPairing {
  userId: string
  chatId: string
  code: string
  expiresAt: number
}

export class TelegramGateway extends GatewayProvider implements AuthorizationRequester {
  private bot: Telegraf | null = null
  private readonly config: ApexConfig
  private readonly isEnabled: boolean
  private readonly botToken?: string
  private readonly ownerChatId?: string
  private readonly log: GatewayLogger
  private readonly energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
  private readonly transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>()
  private readonly pendingPairingsByUser = new Map<string, PendingPairing>()
  private readonly pendingPairingsByCode = new Map<string, PendingPairing>()
  private failedToStart = false
  private patchedFetch = false

  constructor(
    client: RuntimeSubmissionClient,
    options: {
      config?: ApexConfig
      logger?: GatewayLogger
      energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
      transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>
    } = {},
  ) {
    super('telegram', client)
    this.config = options.config ?? defaultConfig
    this.log = options.logger ?? defaultGatewayLogger
    this.energyImpact = options.energyImpact
    this.transcriber = options.transcriber
    this.isEnabled = this.config.gateways.telegram.enabled
    this.botToken = this.config.gateways.telegram.botToken
    this.ownerChatId = this.config.gateways.telegram.chatId
  }

  /**
   * Telegraf v4 uses `abort-controller` shims internally and then calls the global `fetch`.
   * Node 21+ `fetch` (undici) requires `init.signal` to be a native `AbortSignal` instance,
   * otherwise it throws:
   *   "Expected signal to be an instanceof AbortSignal"
   *
   * We patch `globalThis.fetch` once to normalize shim signals into a native AbortSignal.
   * This prevents a fast-failing poll loop from spamming logs forever.
   */
  private ensureAbortSignalCompatibleFetch(): void {
    if (this.patchedFetch) return
    const g: any = globalThis as any
    const originalFetch = g.fetch
    if (typeof originalFetch !== 'function') return

    const isNativeAbortSignal = (s: any) => typeof AbortSignal !== 'undefined' && s instanceof AbortSignal

    const normalizeSignal = (s: any): AbortSignal | undefined => {
      if (!s) return undefined
      if (isNativeAbortSignal(s)) return s
      // Accept common AbortSignal-like shims (e.g. from `abort-controller`).
      const hasEvents =
        typeof s === 'object' &&
        typeof s.aborted === 'boolean' &&
        typeof s.addEventListener === 'function' &&
        typeof s.removeEventListener === 'function'
      if (!hasEvents) return undefined

      const controller = new AbortController()
      const onAbort = () => controller.abort()
      try {
        if (s.aborted) {
          controller.abort()
        } else {
          s.addEventListener('abort', onAbort, { once: true })
        }
      } catch {
        // If the shim is weird, just fall back to no signal.
        return undefined
      }
      return controller.signal
    }

    g.fetch = (input: any, init?: any) => {
      if (init && init.signal && !isNativeAbortSignal(init.signal)) {
        const normalized = normalizeSignal(init.signal)
        if (normalized) init = { ...init, signal: normalized }
        else {
          const { signal: _ignored, ...rest } = init
          init = rest
        }
      }
      return originalFetch(input, init)
    }

    this.patchedFetch = true
  }

  async start(): Promise<void> {
    if (!this.isEnabled) {
      console.log('[Telegram] Disabled')
      return
    }

    if (this.failedToStart) {
      // Prevent infinite retry spam if Telegraf enters a fast-failing polling loop.
      this.log.warn('[Telegram] Previously failed to start; gateway remains disabled until restart.')
      return
    }

    if (!this.botToken || !this.ownerChatId) {
      console.log('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID')
      return
    }

    // Patch fetch before Telegraf constructs its polling client.
    this.ensureAbortSignalCompatibleFetch()

    console.log('[Telegram] Initializing bot')
    this.bot = new Telegraf(this.botToken)

    this.bot.use(async (ctx, next) => {
      this.log.debug(`[Telegram] update type: ${ctx.updateType}`)
      return next()
    })

    const sendStatus = async (chatId: string) => {
      const lines = await getGatewayStatusLines(
        () => this.getSystemUptime(),
        () => this.getBatteryLevel(),
      )
      const text = [
        '󱐋 *Apex Status*',
        ...lines
          .slice(1)
          .map(
            (line) =>
              `• *${escapeTelegramMarkdown(line.split(':')[0] || line)}*${line.includes(':') ? `: ${escapeTelegramMarkdown(line.split(':').slice(1).join(':').trim())}` : ''}`,
          ),
      ].join('\n')
      await this.bot!.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' })
    }

    const sendScreen = async (chatId: string) => {
      const imagePath = '/tmp/screen.png'
      try {
        await captureScreenshot(imagePath, { energyImpact: this.energyImpact })
        await this.bot!.telegram.sendPhoto(chatId, Input.fromLocalFile(imagePath), {
          caption: ' Current desktop snapshot',
        })
      } finally {
        await cleanupScreenshot(imagePath)
      }
    }

    this.bot.command('start', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      await ctx.reply(
        [
          '󱐋 *Apex*',
          'Native macOS intelligence layer online.',
          'Use `/status`, `/screen`, or just send a task.',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      )
    })

    this.bot.command('status', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      await sendStatus(String(ctx.chat.id))
    })

    for (const name of [
      'doctor',
      'queue',
      'sessions',
      'memory',
      'safe',
      'sandbox',
      'model',
      'approvals',
    ] as const) {
      this.bot.command(name, async (ctx) => {
        if (!(await this.ensureAuthorized(ctx))) {
          return
        }

        const chatId = String(ctx.chat.id)
        const text = ctx.message.text.trim()
        const response = await this.dispatch(text, chatId)
        if (response) {
          await this.sendResponse(chatId, response)
          this.log.chat?.('assistant', `[Telegram] ${response}`)
        }
      })
    }

    this.bot.command('screen', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      try {
        await sendScreen(String(ctx.chat.id))
      } catch (error: any) {
        console.log(`[Telegram] /screen failed: ${error.message}`)
        await ctx.reply('󱐋 Unable to capture the screen right now.')
      }
    })

    this.bot.command('approve', async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.reply('󱐋 Only the configured owner can approve pairings.')
        return
      }

      const parts = ctx.message.text.trim().split(/\s+/)
      const code = (parts[1] || '').toUpperCase()
      if (!code) {
        await ctx.reply('󱐋 Usage: /approve <code>')
        return
      }

      const approved = await this.approvePairing(code)
      await ctx.reply(
        approved ? `󱐋 Approved pairing code ${code}.` : `󱐋 Pairing code ${code} was not found or expired.`,
      )
    })

    this.bot.command('deny', async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.reply('󱐋 Only the configured owner can deny pairings.')
        return
      }

      const parts = ctx.message.text.trim().split(/\s+/)
      const code = (parts[1] || '').toUpperCase()
      if (!code) {
        await ctx.reply('󱐋 Usage: /deny <code>')
        return
      }

      const denied = await this.denyPairing(code)
      await ctx.reply(
        denied ? `󱐋 Denied pairing code ${code}.` : `󱐋 Pairing code ${code} was not found or expired.`,
      )
    })

    this.bot.action(/apex_auth_yes:(.+)/, async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.answerCbQuery('Owner approval required')
        return
      }

      await ctx.answerCbQuery('Authorized')
      const id = ctx.match[1]
      const pending = this.pendingAuthorizations.get(id)
      if (!pending) {
        return
      }

      clearTimeout(pending.timeout)
      this.pendingAuthorizations.delete(id)
      pending.resolve(true)
    })

    this.bot.action(/apex_auth_no:(.+)/, async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.answerCbQuery('Owner approval required')
        return
      }

      await ctx.answerCbQuery('Denied')
      const id = ctx.match[1]
      const pending = this.pendingAuthorizations.get(id)
      if (!pending) {
        return
      }

      clearTimeout(pending.timeout)
      this.pendingAuthorizations.delete(id)
      pending.resolve(false)
    })

    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.trim()
      if (!text) {
        return
      }

      if (
        text.startsWith('/start') ||
        text.startsWith('/status') ||
        text.startsWith('/screen') ||
        text.startsWith('/approve') ||
        text.startsWith('/deny') ||
        text.startsWith('/doctor') ||
        text.startsWith('/queue') ||
        text.startsWith('/sessions') ||
        text.startsWith('/memory') ||
        text.startsWith('/safe') ||
        text.startsWith('/sandbox') ||
        text.startsWith('/model') ||
        text.startsWith('/approvals')
      ) {
        return
      }

      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      const chatId = String(ctx.chat.id)
      this.log.chat?.('user', `[Telegram] ${text}`)
      try {
        const response = await this.dispatch(text, chatId, {
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          telegramMessageId: ctx.message.message_id,
        })
        if (response) {
          await this.sendResponse(chatId, response)
          this.log.chat?.('assistant', `[Telegram] ${response}`)
        }
      } catch (error: any) {
        this.log.error(`[Telegram] text dispatch failed: ${error.message}`)
        await ctx.reply(' I could not queue that request right now.')
      }
    })

    this.bot.on('photo', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      const chatId = String(ctx.chat.id)
      const photo = ctx.message.photo[ctx.message.photo.length - 1]
      if (!photo) {
        return
      }

      try {
        const { filePath } = await this.downloadTelegramFile(photo.file_id, 'apex-telegram-photo', '.jpg')
        const imagePath = filePath
        this.log.chat?.('user', '[Telegram] Sent a photo')
        try {
          const response = await this.dispatch(
            `Analyze this Telegram image immediately using analyze_image_content with path "${imagePath}". Describe what is important, extract any visible text if relevant, and recommend or take the next best action.`,
            chatId,
            {
              username: ctx.from?.username,
              firstName: ctx.from?.first_name,
              telegramPhotoId: photo.file_id,
              downloadedImagePath: imagePath,
            },
          )
          if (response) {
            await this.sendResponse(chatId, response)
            this.log.chat?.('assistant', `[Telegram] ${response}`)
          }
        } finally {
          await cleanupTempFile(imagePath)
        }
      } catch (error: any) {
        this.log.error(`[Telegram] photo handling failed: ${error.message}`)
        await ctx.reply(' I could not process that image.')
      }
    })

    this.bot.on('document', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      const document = ctx.message.document
      const extension = path.extname(document.file_name || '').toLowerCase()
      if (!TELEGRAM_DOCUMENT_EXTENSIONS.has(extension)) {
        await ctx.reply(' Unsupported document type. Send PDF, text, markdown, or supported image files.')
        return
      }

      let filePath: string | undefined
      try {
        const download = await this.downloadTelegramFile(
          document.file_id,
          'apex-telegram-document',
          extension || '.bin',
        )
        filePath = download.filePath
        const prompt =
          extension === '.pdf'
            ? `Read this PDF immediately using read_pdf_content with path "${filePath}". Summarize the important contents and recommend the next best action.`
            : ['.jpg', '.jpeg', '.png'].includes(extension)
              ? `Analyze this image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`
              : `Read this file immediately using read_text_file with path "${filePath}". Summarize the important contents and recommend the next best action.`

        try {
          const response = await this.dispatch(prompt, String(ctx.chat.id), {
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            telegramDocumentId: document.file_id,
            downloadedFilePath: filePath,
          })
          if (response) {
            await this.sendResponse(String(ctx.chat.id), response)
            this.log.chat?.('assistant', `[Telegram] ${response}`)
          }
        } finally {
          await cleanupTempFile(filePath)
        }
      } catch (error: any) {
        await cleanupTempFile(filePath)
        this.log.error(`[Telegram] document handling failed: ${error.message}`)
        await ctx.reply(` I could not process that document: ${error.message}`)
      }
    })

    this.bot.on('voice', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return
      }

      let filePath: string | undefined
      try {
        const download = await this.downloadTelegramFile(
          ctx.message.voice.file_id,
          'apex-telegram-voice',
          '.ogg',
        )
        filePath = download.filePath
        if (!this.transcriber) {
          throw new Error('Audio transcription is unavailable (no transcriber configured).')
        }
        const transcript = await transcribeAudioFile(filePath, { transcribe: this.transcriber })
        try {
          const response = await this.dispatch(
            `The user sent a voice note. Transcript: ${transcript}`,
            String(ctx.chat.id),
            {
              username: ctx.from?.username,
              firstName: ctx.from?.first_name,
              telegramVoiceId: ctx.message.voice.file_id,
            },
          )
          if (response) {
            await this.sendResponse(String(ctx.chat.id), response)
            this.log.chat?.('assistant', `[Telegram] ${response}`)
          }
        } finally {
          await cleanupTempFile(filePath)
        }
      } catch (error: any) {
        await cleanupTempFile(filePath)
        await ctx.reply(
          ` Voice note received, but transcription is unavailable: ${error.message} ${getTranscriptionSetupHint()}`,
        )
      }
    })

    try {
      await this.bot.launch()
      console.log('[Telegram] Bot ready')
    } catch (error: any) {
      this.failedToStart = true
      const msg = error?.message ?? String(error)
      this.log.error(`[Telegram] Failed to start. Disabling gateway. ${msg}`)
      try {
        await this.stop()
      } catch {
        // ignore
      }
      this.bot = null
    }
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized.')
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3500)) {
      await this.bot.telegram.sendMessage(to, escapeTelegramMarkdown(chunk), { parse_mode: 'MarkdownV2' })
    }
  }

  getPendingApprovalCount(): number {
    return this.pendingAuthorizations.size
  }

  listPendingApprovals(): PendingApprovalSummary[] {
    return Array.from(this.pendingAuthorizations.values()).map(({ request }) => ({
      id: request.id,
      source: request.source,
      sourceId: request.sourceId,
      toolName: request.toolName,
      permissionClass: request.permissionClass,
      command: request.command,
      reason: request.reason,
      expiresAt: request.expiresAt,
    }))
  }

  settleApproval(id: string, approved: boolean): boolean {
    const pending = this.pendingAuthorizations.get(id)
    if (!pending) {
      return false
    }

    clearTimeout(pending.timeout)
    this.pendingAuthorizations.delete(id)
    pending.resolve(approved)
    return true
  }

  async stop(): Promise<void> {
    for (const pending of this.pendingAuthorizations.values()) {
      clearTimeout(pending.timeout)
      pending.resolve(false)
    }
    this.pendingAuthorizations.clear()
    await this.bot?.stop()
    this.bot = null
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.bot || !this.ownerChatId) {
      throw new Error('Telegram authorization requested but bot is not initialized.')
    }

    const expiresAt = request.expiresAt
      ? new Date(request.expiresAt).getTime()
      : Date.now() + this.config.security.authorizationTimeoutMs
    await this.bot.telegram.sendMessage(
      this.ownerChatId,
      [
        `⚠️ ${escapeTelegramMarkdown(request.permissionClass.toUpperCase())} approval required`,
        `Tool: \`${escapeTelegramMarkdown(request.toolName)}\``,
        `Command: \`${escapeTelegramMarkdown(request.command)}\``,
        `Reason: ${escapeTelegramMarkdown(request.reason)}`,
        `Expires: ${escapeTelegramMarkdown(new Date(expiresAt).toLocaleTimeString())}`,
      ].join('\n'),
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          Markup.button.callback('YES', `apex_auth_yes:${request.id}`),
          Markup.button.callback('NO', `apex_auth_no:${request.id}`),
        ]),
      },
    )

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(
        () => {
          this.pendingAuthorizations.delete(request.id)
          void writeSecurityAudit({
            timestamp: new Date().toISOString(),
            type: 'authorization_expired',
            source: request.source,
            actor: this.ownerChatId,
            toolName: request.toolName,
            permissionClass: request.permissionClass,
            detail: `Authorization expired for ${request.toolName}`,
          })
          resolve(false)
        },
        Math.max(1, expiresAt - Date.now()),
      )

      this.pendingAuthorizations.set(request.id, {
        request,
        resolve,
        expiresAt,
        timeout,
      })
    })
  }

  private isOwner(fromId: number | undefined): boolean {
    return String(fromId ?? '') === this.ownerChatId
  }

  private isAuthorized(fromId: number | undefined): boolean {
    const normalized = String(fromId ?? '')
    return normalized !== '' && (normalized === this.ownerChatId || isTelegramUserPaired(normalized))
  }

  private async ensureAuthorized(ctx: any): Promise<boolean> {
    if (this.isAuthorized(ctx.from?.id)) {
      return true
    }

    await this.sendPairingInstructions(ctx)
    return false
  }

  private async sendPairingInstructions(ctx: any): Promise<void> {
    const userId = String(ctx.from?.id ?? '')
    const chatId = String(ctx.chat?.id ?? '')
    let pending: PendingPairing
    let isNew: boolean
    try {
      const out = this.getOrCreatePairing(userId, chatId)
      pending = out.pairing
      isNew = out.isNew
    } catch (e) {
      if (e instanceof PairingRateLimitedError) {
        await ctx.reply('Too many new pairing attempts. Please try again later.')
        return
      }
      throw e
    }

    if (isNew) {
      void writeSecurityAudit({
        timestamp: new Date().toISOString(),
        type: 'pairing_requested',
        source: 'telegram',
        actor: userId,
        detail: 'Pairing requested (telegram)',
      })
    }

    await ctx.reply(
      [
        ' This Telegram account is not paired yet.',
        `Pairing code: ${pending.code}`,
        'Send `/approve <code>` from the owner Telegram account to allow access.',
      ].join('\n'),
    )

    if (isNew && this.bot && this.ownerChatId) {
      await this.bot.telegram.sendMessage(
        this.ownerChatId,
        `Apex pairing request from ${userId}. Approve with /approve ${pending.code} or deny with /deny ${pending.code}.`,
      )
    }
  }

  private getOrCreatePairing(userId: string, chatId: string): { pairing: PendingPairing; isNew: boolean } {
    const existing = this.pendingPairingsByUser.get(userId)
    if (existing && existing.expiresAt > Date.now()) {
      return { pairing: existing, isNew: false }
    }

    if (existing) {
      this.pendingPairingsByUser.delete(userId)
      this.pendingPairingsByCode.delete(existing.code.toUpperCase())
    }

    const rateKey = pairingRateLimitKey('telegram', userId)
    if (!recordNewPairingCode(rateKey)) {
      throw new PairingRateLimitedError()
    }

    const pairing: PendingPairing = {
      userId,
      chatId,
      code: generatePairingCode(),
      expiresAt: Date.now() + this.config.security.pairingCodeTtlMs,
    }
    this.pendingPairingsByUser.set(userId, pairing)
    this.pendingPairingsByCode.set(pairing.code.toUpperCase(), pairing)
    return { pairing, isNew: true }
  }

  private async approvePairing(code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase()
    const pairing = this.pendingPairingsByCode.get(normalized)
    if (!pairing || pairing.expiresAt <= Date.now()) {
      return false
    }

    approveTelegramUser(pairing.userId)
    this.pendingPairingsByCode.delete(normalized)
    this.pendingPairingsByUser.delete(pairing.userId)
    void writeSecurityAudit({
      timestamp: new Date().toISOString(),
      type: 'pairing_approved',
      source: 'telegram',
      actor: pairing.userId,
      detail: `Approved telegram pairing for user ${pairing.userId}`,
    })

    if (this.bot) {
      await this.bot.telegram.sendMessage(
        pairing.chatId,
        '󱐋 Pairing approved. You can now use Apex from this Telegram account.',
      )
    }

    return true
  }

  private async denyPairing(code: string): Promise<boolean> {
    const normalized = code.trim().toUpperCase()
    const pairing = this.pendingPairingsByCode.get(normalized)
    if (!pairing || pairing.expiresAt <= Date.now()) {
      return false
    }

    this.pendingPairingsByCode.delete(normalized)
    this.pendingPairingsByUser.delete(pairing.userId)
    void writeSecurityAudit({
      timestamp: new Date().toISOString(),
      type: 'pairing_denied',
      source: 'telegram',
      actor: pairing.userId,
      detail: `Denied telegram pairing for user ${pairing.userId}`,
    })

    if (this.bot) {
      await this.bot.telegram.sendMessage(pairing.chatId, ' Pairing denied by the owner account.')
    }

    return true
  }

  private async downloadTelegramFile(
    fileId: string,
    prefix: string,
    extension: string,
  ): Promise<{ buffer: Buffer; filePath: string }> {
    const fileUrl = await this.bot!.telegram.getFileLink(fileId)
    const response = await fetch(fileUrl)
    if (!response.ok) {
      throw new Error(`Telegram file download failed with status ${response.status}`)
    }

    const contentLengthHeader = response.headers.get('content-length')
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0
    if (contentLength > this.config.media.maxTelegramFileBytes) {
      throw new Error(`File exceeds ${this.config.media.maxTelegramFileBytes} bytes.`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > this.config.media.maxTelegramFileBytes) {
      throw new Error(`File exceeds ${this.config.media.maxTelegramFileBytes} bytes.`)
    }

    const filePath = await writeTempMediaFile(prefix, extension, buffer)
    return { buffer, filePath }
  }

  private async getBatteryLevel(): Promise<string> {
    try {
      const { stdout } = (await execFileAsync('pmset', ['-g', 'batt'], { windowsHide: true })) as unknown as {
        stdout: string | Buffer
      }
      const match = String(stdout).match(/(\d+)%/)
      return match ? `${match[1]}%` : 'Unknown'
    } catch (error: any) {
      this.log.error(`Battery status unavailable: ${error.message}`)
      return 'Unknown'
    }
  }

  private async getSystemUptime(): Promise<string> {
    try {
      const { stdout } = (await execFileAsync('uptime', [], { windowsHide: true })) as unknown as {
        stdout: string | Buffer
      }
      return String(stdout).trim()
    } catch (error: any) {
      this.log.error(`System uptime unavailable: ${error.message}`)
      return 'Unknown'
    }
  }
}

export function createTelegramGateway(
  client: RuntimeSubmissionClient,
  options: {
    config?: ApexConfig
    logger?: GatewayLogger
    energyImpact?: { recordEnergyImpact(metric: 'screenshot', amount?: number): void }
    transcriber?: (model: string, audioPath: string, prompt: string) => Promise<string>
  } = {},
) {
  return new TelegramGateway(client, options)
}
