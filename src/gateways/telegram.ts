import { Input, Markup, Telegraf } from 'telegraf';
import { AuthorizationRequester, GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { vectorStore } from '../db/vectorStore';
import { AuthorizationRequest } from '../types';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';

export class TelegramGateway extends GatewayProvider implements AuthorizationRequester {
  private bot: Telegraf | null = null;
  private readonly isEnabled = process.env.TELEGRAM_ENABLED === '1' || process.env.TELEGRAM_ENABLED === 'true';
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  private readonly allowedChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  private readonly pendingAuthorizations = new Map<string, (approved: boolean) => void>();

  constructor(sink: GatewayTaskSink) {
    super('telegram', sink);
  }

  async start(): Promise<void> {
    if (!this.isEnabled) {
      console.log('[Telegram] Disabled');
      return;
    }

    if (!this.botToken || !this.allowedChatId) {
      console.log('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return;
    }

    console.log('[Telegram] Initializing bot');
    this.bot = new Telegraf(this.botToken);

    this.bot.use(async (ctx, next) => {
      // Telegram bot updates are delivered by Telegram infrastructure, not directly
      // from the user's iPhone, so Tailscale IP filtering cannot be enforced here.
      // Keep TELEGRAM_CHAT_ID as the primary identity gate and keep local services
      // like Ollama bound to localhost or a Tailscale-only interface.
      logger.debug(`[Telegram] update type: ${ctx.updateType}`);
      return next();
    });

    const sendStatus = async (chatId: string) => {
      const memoryCount = await vectorStore.count();
      const uptime = this.getSystemUptime();
      const battery = this.getBatteryLevel();
      const text = [
        ' *OpenMac Status*',
        `• Vector Memory Facts: *${memoryCount}*`,
        `• System Uptime: *${uptime}*`,
        `• Battery: *${battery}*`,
      ].join('\n');
      await this.bot!.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    };

    const sendScreen = async (chatId: string) => {
      const imagePath = '/tmp/screen.png';
      try {
        execSync(`screencapture -x ${imagePath}`);
        await this.bot!.telegram.sendPhoto(chatId, Input.fromLocalFile(imagePath), {
          caption: ' Current desktop snapshot',
        });
      } finally {
        await fs.unlink(imagePath).catch(() => undefined);
      }
    };

    this.bot.command('start', async (ctx) => {
      if (!this.isAuthorized(ctx.from?.id)) {
        console.log(`[Telegram] Ignoring unauthorized sender: ${String(ctx.from?.id ?? 'unknown')}`);
        return;
      }

      await ctx.reply(
        [
          ' *OpenMac*',
          'Elite macOS autonomous agent online.',
          'Use `/status`, `/screen`, or just send a task.',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('status', async (ctx) => {
      if (!this.isAuthorized(ctx.from?.id)) {
        console.log(`[Telegram] Ignoring unauthorized sender: ${String(ctx.from?.id ?? 'unknown')}`);
        return;
      }

      await sendStatus(String(ctx.chat.id));
    });

    this.bot.command('screen', async (ctx) => {
      if (!this.isAuthorized(ctx.from?.id)) {
        console.log(`[Telegram] Ignoring unauthorized sender: ${String(ctx.from?.id ?? 'unknown')}`);
        return;
      }

      const chatId = String(ctx.chat.id);
      try {
        await sendScreen(chatId);
      } catch (error: any) {
        console.log(`[Telegram] /screen failed: ${error.message}`);
        await ctx.reply(' Unable to capture the screen right now.');
      }
    });

    this.bot.action(/openmac_auth_yes:(.+)/, async (ctx) => {
      await ctx.answerCbQuery('Authorized');
      const id = ctx.match[1];
      const resolver = this.pendingAuthorizations.get(id);
      this.pendingAuthorizations.delete(id);
      resolver?.(true);
    });

    this.bot.action(/openmac_auth_no:(.+)/, async (ctx) => {
      await ctx.answerCbQuery('Denied');
      const id = ctx.match[1];
      const resolver = this.pendingAuthorizations.get(id);
      this.pendingAuthorizations.delete(id);
      resolver?.(false);
    });

    this.bot.on('text', async (ctx) => {
      const chatId = String(ctx.chat.id);
      const fromId = String(ctx.from?.id ?? '');
      if (!this.isAuthorized(ctx.from?.id)) {
        console.log(`[Telegram] Ignoring unauthorized sender: ${fromId || 'unknown'}`);
        return;
      }

      const text = ctx.message.text.trim();
      if (!text) {
        return;
      }

      if (text === '/start' || text === '/status' || text === '/screen') {
        return;
      }

      logger.chat('user', `[Telegram] ${text}`);
      void this.dispatch(text, chatId, {
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        telegramMessageId: ctx.message.message_id,
      });
    });

    this.bot.on('photo', async (ctx) => {
      const chatId = String(ctx.chat.id);
      const fromId = String(ctx.from?.id ?? '');
      if (!this.isAuthorized(ctx.from?.id)) {
        console.log(`[Telegram] Ignoring unauthorized sender: ${fromId || 'unknown'}`);
        return;
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      if (!photo) {
        return;
      }

      try {
        const fileUrl = await this.bot!.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Telegram file download failed with status ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const imagePath = path.join(os.tmpdir(), `openmac-telegram-photo-${Date.now()}.jpg`);
        await fs.writeFile(imagePath, buffer);
        logger.chat('user', '[Telegram] Sent a photo');
        void this.dispatch(
          `Analyze this Telegram image immediately using analyze_image_content with path "${imagePath}". Describe what is important, extract any visible text if relevant, and recommend or take the next best action.`,
          chatId,
          {
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            telegramPhotoId: photo.file_id,
            downloadedImagePath: imagePath,
          },
        );
      } catch (error: any) {
        console.log(`[Telegram] photo handling failed: ${error.message}`);
        await ctx.reply(' I could not process that image.');
      }
    });

    await this.bot.launch();
    console.log('[Telegram] Bot ready');
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized.');
    }

    await this.bot.telegram.sendMessage(to, text, { parse_mode: 'Markdown' });
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.bot || !this.allowedChatId) {
      throw new Error('Telegram authorization requested but bot is not initialized.');
    }

    await this.bot.telegram.sendMessage(
      this.allowedChatId,
      `⚠️ OpenMac wants to execute: \`${request.command}\`. Authorize?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('YES', `openmac_auth_yes:${request.id}`),
          Markup.button.callback('NO', `openmac_auth_no:${request.id}`),
        ]),
      },
    );

    return new Promise<boolean>((resolve) => {
      this.pendingAuthorizations.set(request.id, resolve);
    });
  }

  private isAuthorized(fromId: number | undefined): boolean {
    return String(fromId ?? '') === this.allowedChatId;
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

export function createTelegramGateway(sink: GatewayTaskSink) {
  return new TelegramGateway(sink);
}
