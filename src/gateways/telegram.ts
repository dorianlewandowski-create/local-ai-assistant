import { Input, Markup, Telegraf } from 'telegraf';
import { AuthorizationRequester, GatewayProvider, RuntimeSubmissionClient } from './base';
import { logger } from '../utils/logger';
import { AuthorizationRequest } from '../types';
import { config } from '../config';
import { escapeTelegramMarkdown } from '../utils/telegramMarkdown';
import { approveTelegramUser, isTelegramUserPaired } from '../security/pairingStore';
import { writeSecurityAudit } from '../security/audit';
import path from 'path';
import { execSync } from 'child_process';
import { cleanupTempFile, writeTempMediaFile } from '../media/files';
import { getTranscriptionSetupHint, transcribeAudioFile } from '../media/transcription';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';
import { getGatewayStatusLines } from './status';
import { captureScreenshot, cleanupScreenshot } from './screenshot';
import { PendingApprovalSummary } from './nativeApproval';

const TELEGRAM_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.jpg', '.jpeg', '.png']);

interface PendingAuthorization {
  request: AuthorizationRequest;
  resolve: (approved: boolean) => void;
  expiresAt: number;
  timeout: NodeJS.Timeout;
}

interface PendingPairing {
  userId: string;
  chatId: string;
  code: string;
  expiresAt: number;
}

export class TelegramGateway extends GatewayProvider implements AuthorizationRequester {
  private bot: Telegraf | null = null;
  private readonly isEnabled = config.gateways.telegram.enabled;
  private readonly botToken = config.gateways.telegram.botToken;
  private readonly ownerChatId = config.gateways.telegram.chatId;
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
  private readonly pendingPairingsByUser = new Map<string, PendingPairing>();
  private readonly pendingPairingsByCode = new Map<string, PendingPairing>();

  constructor(client: RuntimeSubmissionClient) {
    super('telegram', client);
  }

  async start(): Promise<void> {
    if (!this.isEnabled) {
      console.log('[Telegram] Disabled');
      return;
    }

    if (!this.botToken || !this.ownerChatId) {
      console.log('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return;
    }

    console.log('[Telegram] Initializing bot');
    this.bot = new Telegraf(this.botToken);

    this.bot.use(async (ctx, next) => {
      logger.debug(`[Telegram] update type: ${ctx.updateType}`);
      return next();
    });

    const sendStatus = async (chatId: string) => {
      const lines = await getGatewayStatusLines(() => this.getSystemUptime(), () => this.getBatteryLevel());
      const text = [
        ' *OpenMac Status*',
        ...lines.slice(1).map((line) => `• *${escapeTelegramMarkdown(line.split(':')[0] || line)}*${line.includes(':') ? `: ${escapeTelegramMarkdown(line.split(':').slice(1).join(':').trim())}` : ''}`),
      ].join('\n');
      await this.bot!.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    };

    const sendScreen = async (chatId: string) => {
      const imagePath = '/tmp/screen.png';
      try {
        await captureScreenshot(imagePath);
        await this.bot!.telegram.sendPhoto(chatId, Input.fromLocalFile(imagePath), {
          caption: ' Current desktop snapshot',
        });
      } finally {
        await cleanupScreenshot(imagePath);
      }
    };

    this.bot.command('start', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      await ctx.reply([
        ' *OpenMac*',
        'Elite macOS autonomous agent online.',
        'Use `/status`, `/screen`, or just send a task.',
      ].join('\n'), { parse_mode: 'Markdown' });
    });

    this.bot.command('status', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      await sendStatus(String(ctx.chat.id));
    });

    for (const name of ['doctor', 'queue', 'sessions', 'memory', 'safe', 'sandbox', 'model', 'approvals'] as const) {
      this.bot.command(name, async (ctx) => {
        if (!(await this.ensureAuthorized(ctx))) {
          return;
        }

        const chatId = String(ctx.chat.id);
        const text = ctx.message.text.trim();
        const response = await this.dispatch(text, chatId);
        if (response) {
          await this.sendResponse(chatId, response);
          logger.chat('assistant', `[Telegram] ${response}`);
        }
      });
    }

    this.bot.command('screen', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      try {
        await sendScreen(String(ctx.chat.id));
      } catch (error: any) {
        console.log(`[Telegram] /screen failed: ${error.message}`);
        await ctx.reply(' Unable to capture the screen right now.');
      }
    });

    this.bot.command('approve', async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.reply(' Only the configured owner can approve pairings.');
        return;
      }

      const parts = ctx.message.text.trim().split(/\s+/);
      const code = (parts[1] || '').toUpperCase();
      if (!code) {
        await ctx.reply(' Usage: /approve <code>');
        return;
      }

      const approved = await this.approvePairing(code);
      await ctx.reply(approved ? ` Approved pairing code ${code}.` : ` Pairing code ${code} was not found or expired.`);
    });

    this.bot.command('deny', async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.reply(' Only the configured owner can deny pairings.');
        return;
      }

      const parts = ctx.message.text.trim().split(/\s+/);
      const code = (parts[1] || '').toUpperCase();
      if (!code) {
        await ctx.reply(' Usage: /deny <code>');
        return;
      }

      const denied = await this.denyPairing(code);
      await ctx.reply(denied ? ` Denied pairing code ${code}.` : ` Pairing code ${code} was not found or expired.`);
    });

    this.bot.action(/openmac_auth_yes:(.+)/, async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.answerCbQuery('Owner approval required');
        return;
      }

      await ctx.answerCbQuery('Authorized');
      const id = ctx.match[1];
      const pending = this.pendingAuthorizations.get(id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingAuthorizations.delete(id);
      pending.resolve(true);
    });

    this.bot.action(/openmac_auth_no:(.+)/, async (ctx) => {
      if (!this.isOwner(ctx.from?.id)) {
        await ctx.answerCbQuery('Owner approval required');
        return;
      }

      await ctx.answerCbQuery('Denied');
      const id = ctx.match[1];
      const pending = this.pendingAuthorizations.get(id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingAuthorizations.delete(id);
      pending.resolve(false);
    });

    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (!text) {
        return;
      }

      if (text.startsWith('/start') || text.startsWith('/status') || text.startsWith('/screen') || text.startsWith('/approve') || text.startsWith('/deny') || text.startsWith('/doctor') || text.startsWith('/queue') || text.startsWith('/sessions') || text.startsWith('/memory') || text.startsWith('/safe') || text.startsWith('/sandbox') || text.startsWith('/model') || text.startsWith('/approvals')) {
        return;
      }

      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      const chatId = String(ctx.chat.id);
      logger.chat('user', `[Telegram] ${text}`);
      try {
        const response = await this.dispatch(text, chatId, {
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          telegramMessageId: ctx.message.message_id,
        });
        if (response) {
          await this.sendResponse(chatId, response);
          logger.chat('assistant', `[Telegram] ${response}`);
        }
      } catch (error: any) {
        logger.error(`[Telegram] text dispatch failed: ${error.message}`);
        await ctx.reply(' I could not queue that request right now.');
      }
    });

    this.bot.on('photo', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      const chatId = String(ctx.chat.id);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      if (!photo) {
        return;
      }

      try {
        const { filePath } = await this.downloadTelegramFile(photo.file_id, 'openmac-telegram-photo', '.jpg');
        const imagePath = filePath;
        logger.chat('user', '[Telegram] Sent a photo');
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
          );
          if (response) {
            await this.sendResponse(chatId, response);
            logger.chat('assistant', `[Telegram] ${response}`);
          }
        } finally {
          await cleanupTempFile(imagePath);
        }
      } catch (error: any) {
        console.log(`[Telegram] photo handling failed: ${error.message}`);
        await ctx.reply(' I could not process that image.');
      }
    });

    this.bot.on('document', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      const document = ctx.message.document;
      const extension = path.extname(document.file_name || '').toLowerCase();
      if (!TELEGRAM_DOCUMENT_EXTENSIONS.has(extension)) {
        await ctx.reply(' Unsupported document type. Send PDF, text, markdown, or supported image files.');
        return;
      }

      let filePath: string | undefined;
      try {
        const download = await this.downloadTelegramFile(document.file_id, 'openmac-telegram-document', extension || '.bin');
        filePath = download.filePath;
        const prompt = extension === '.pdf'
          ? `Read this PDF immediately using read_pdf_content with path "${filePath}". Summarize the important contents and recommend the next best action.`
          : ['.jpg', '.jpeg', '.png'].includes(extension)
            ? `Analyze this image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`
            : `Read this file immediately using read_text_file with path "${filePath}". Summarize the important contents and recommend the next best action.`;

        try {
          const response = await this.dispatch(prompt, String(ctx.chat.id), {
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            telegramDocumentId: document.file_id,
            downloadedFilePath: filePath,
          });
          if (response) {
            await this.sendResponse(String(ctx.chat.id), response);
            logger.chat('assistant', `[Telegram] ${response}`);
          }
        } finally {
          await cleanupTempFile(filePath);
        }
      } catch (error: any) {
        await cleanupTempFile(filePath);
        logger.error(`[Telegram] document handling failed: ${error.message}`);
        await ctx.reply(` I could not process that document: ${error.message}`);
      }
    });

    this.bot.on('voice', async (ctx) => {
      if (!(await this.ensureAuthorized(ctx))) {
        return;
      }

      let filePath: string | undefined;
      try {
        const download = await this.downloadTelegramFile(ctx.message.voice.file_id, 'openmac-telegram-voice', '.ogg');
        filePath = download.filePath;
        const transcript = await transcribeAudioFile(filePath);
        try {
          const response = await this.dispatch(`The user sent a voice note. Transcript: ${transcript}`, String(ctx.chat.id), {
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            telegramVoiceId: ctx.message.voice.file_id,
          });
          if (response) {
            await this.sendResponse(String(ctx.chat.id), response);
            logger.chat('assistant', `[Telegram] ${response}`);
          }
        } finally {
          await cleanupTempFile(filePath);
        }
      } catch (error: any) {
        await cleanupTempFile(filePath);
        await ctx.reply(` Voice note received, but transcription is unavailable: ${error.message} ${getTranscriptionSetupHint()}`);
      }
    });

    await this.bot.launch();
    console.log('[Telegram] Bot ready');
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized.');
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3500)) {
      await this.bot.telegram.sendMessage(to, escapeTelegramMarkdown(chunk), { parse_mode: 'MarkdownV2' });
    }
  }

  getPendingApprovalCount(): number {
    return this.pendingAuthorizations.size;
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
    }));
  }

  settleApproval(id: string, approved: boolean): boolean {
    const pending = this.pendingAuthorizations.get(id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingAuthorizations.delete(id);
    pending.resolve(approved);
    return true;
  }

  async stop(): Promise<void> {
    for (const pending of this.pendingAuthorizations.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.pendingAuthorizations.clear();
    await this.bot?.stop();
    this.bot = null;
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.bot || !this.ownerChatId) {
      throw new Error('Telegram authorization requested but bot is not initialized.');
    }

    const expiresAt = request.expiresAt ? new Date(request.expiresAt).getTime() : Date.now() + config.security.authorizationTimeoutMs;
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
          Markup.button.callback('YES', `openmac_auth_yes:${request.id}`),
          Markup.button.callback('NO', `openmac_auth_no:${request.id}`),
        ]),
      },
    );

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingAuthorizations.delete(request.id);
        writeSecurityAudit({
          timestamp: new Date().toISOString(),
          type: 'authorization_expired',
          source: request.source,
          actor: this.ownerChatId,
          toolName: request.toolName,
          permissionClass: request.permissionClass,
          detail: `Authorization expired for ${request.toolName}`,
        });
        resolve(false);
      }, Math.max(1, expiresAt - Date.now()));

      this.pendingAuthorizations.set(request.id, {
        request,
        resolve,
        expiresAt,
        timeout,
      });
    });
  }

  private isOwner(fromId: number | undefined): boolean {
    return String(fromId ?? '') === this.ownerChatId;
  }

  private isAuthorized(fromId: number | undefined): boolean {
    const normalized = String(fromId ?? '');
    return normalized !== '' && (normalized === this.ownerChatId || isTelegramUserPaired(normalized));
  }

  private async ensureAuthorized(ctx: any): Promise<boolean> {
    if (this.isAuthorized(ctx.from?.id)) {
      return true;
    }

    await this.sendPairingInstructions(ctx);
    return false;
  }

  private async sendPairingInstructions(ctx: any): Promise<void> {
    const userId = String(ctx.from?.id ?? '');
    const chatId = String(ctx.chat?.id ?? '');
    const { pairing: pending, isNew } = this.getOrCreatePairing(userId, chatId);

    if (isNew) {
      writeSecurityAudit({
        timestamp: new Date().toISOString(),
        type: 'pairing_requested',
        source: 'telegram',
        actor: userId,
        detail: `Pairing requested with code ${pending.code}`,
      });
    }

    await ctx.reply([
      ' This Telegram account is not paired yet.',
      `Pairing code: ${pending.code}`,
      'Send `/approve <code>` from the owner Telegram account to allow access.',
    ].join('\n'));

    if (isNew && this.bot && this.ownerChatId) {
      await this.bot.telegram.sendMessage(this.ownerChatId, `OpenMac pairing request from ${userId}. Approve with /approve ${pending.code} or deny with /deny ${pending.code}.`);
    }
  }

  private getOrCreatePairing(userId: string, chatId: string): { pairing: PendingPairing; isNew: boolean } {
    const existing = this.pendingPairingsByUser.get(userId);
    if (existing && existing.expiresAt > Date.now()) {
      return { pairing: existing, isNew: false };
    }

    if (existing) {
      this.pendingPairingsByUser.delete(userId);
      this.pendingPairingsByCode.delete(existing.code);
    }

    const pairing: PendingPairing = {
      userId,
      chatId,
      code: this.generatePairingCode(),
      expiresAt: Date.now() + config.security.pairingCodeTtlMs,
    };
    this.pendingPairingsByUser.set(userId, pairing);
    this.pendingPairingsByCode.set(pairing.code, pairing);
    return { pairing, isNew: true };
  }

  private async approvePairing(code: string): Promise<boolean> {
    const pairing = this.pendingPairingsByCode.get(code);
    if (!pairing || pairing.expiresAt <= Date.now()) {
      return false;
    }

    approveTelegramUser(pairing.userId);
    this.pendingPairingsByCode.delete(code);
    this.pendingPairingsByUser.delete(pairing.userId);
    writeSecurityAudit({
      timestamp: new Date().toISOString(),
      type: 'pairing_approved',
      source: 'telegram',
      actor: pairing.userId,
      detail: `Approved pairing code ${code}`,
    });

    if (this.bot) {
      await this.bot.telegram.sendMessage(pairing.chatId, ' Pairing approved. You can now use OpenMac from this Telegram account.');
    }

    return true;
  }

  private async denyPairing(code: string): Promise<boolean> {
    const pairing = this.pendingPairingsByCode.get(code);
    if (!pairing || pairing.expiresAt <= Date.now()) {
      return false;
    }

    this.pendingPairingsByCode.delete(code);
    this.pendingPairingsByUser.delete(pairing.userId);
    writeSecurityAudit({
      timestamp: new Date().toISOString(),
      type: 'pairing_denied',
      source: 'telegram',
      actor: pairing.userId,
      detail: `Denied pairing code ${code}`,
    });

    if (this.bot) {
      await this.bot.telegram.sendMessage(pairing.chatId, ' Pairing denied by the owner account.');
    }

    return true;
  }

  private generatePairingCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  private async downloadTelegramFile(fileId: string, prefix: string, extension: string): Promise<{ buffer: Buffer; filePath: string }> {
    const fileUrl = await this.bot!.telegram.getFileLink(fileId);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Telegram file download failed with status ${response.status}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (contentLength > config.media.maxTelegramFileBytes) {
      throw new Error(`File exceeds ${config.media.maxTelegramFileBytes} bytes.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > config.media.maxTelegramFileBytes) {
      throw new Error(`File exceeds ${config.media.maxTelegramFileBytes} bytes.`);
    }

    const filePath = await writeTempMediaFile(prefix, extension, buffer);
    return { buffer, filePath };
  }

  private getBatteryLevel(): string {
    try {
      const stdout = execSync('pmset -g batt', { encoding: 'utf-8' });
      const match = stdout.match(/(\d+)%/);
      return match ? `${match[1]}%` : 'Unknown';
    } catch (error: any) {
      logger.error(`Battery status unavailable: ${error.message}`);
      return 'Unknown';
    }
  }

  private getSystemUptime(): string {
    try {
      return execSync('uptime', { encoding: 'utf-8' }).trim();
    } catch (error: any) {
      logger.error(`System uptime unavailable: ${error.message}`);
      return 'Unknown';
    }
  }
}

export function createTelegramGateway(client: RuntimeSubmissionClient) {
  return new TelegramGateway(client);
}
