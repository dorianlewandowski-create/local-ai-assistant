import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';
import { TaskEnvelope } from '../types';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';
import { getGatewayStatusLines } from './status';
import { getOrCreatePairingCode } from '../security/channelPairingStore';
import { isWhatsAppMessageAuthorized } from './whatsappPolicy';

type AdminCommandHandler = (task: TaskEnvelope, input: string) => Promise<string | null>;

const CHROME_CANDIDATES = [
  config.gateways.whatsapp.executablePath,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((value): value is string => Boolean(value));

function getExecutablePath(): string | undefined {
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

export class WhatsAppGateway extends GatewayProvider {
  private client: Client | null = null;

  constructor(sink: GatewayTaskSink, private readonly handleAdminCommand?: AdminCommandHandler) {
    super('whatsapp', sink);
  }

  async start(): Promise<void> {
    if (!config.gateways.whatsapp.enabled) {
      logger.debug('WhatsApp disabled');
      return;
    }

    const executablePath = getExecutablePath();
    logger.system('WhatsApp initializing client');
    if (executablePath) {
      logger.system(`WhatsApp using browser: ${executablePath}`);
    } else {
      logger.warn('WhatsApp enabled but no Chrome/Chromium executable was found; Puppeteer may fail to launch');
    }

    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
        executablePath,
      },
    });

    this.client.on('qr', (qr) => {
      logger.system('WhatsApp QR code received. Scan it with WhatsApp.');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      logger.system('WhatsApp client ready');
    });

    this.client.on('message', (message) => {
      const text = message.body.trim();
      const authorId = message.author || message.from;
      if (!this.isAuthorized(message.from, authorId)) {
        if (message.from.endsWith('@g.us')) {
          void message.reply('OpenMac is not enabled for this group sender yet. Add the sender to OPENMAC_WHATSAPP_GROUP_ALLOW_FROM or change OPENMAC_WHATSAPP_GROUP_POLICY.');
          return;
        }

        const { code } = getOrCreatePairingCode('whatsapp', message.from);
        void message.reply(`OpenMac WhatsApp is not paired for this chat yet. Pairing code: ${code}. Approve locally with: openmac pairing approve whatsapp ${code}`);
        return;
      }

      if (text === '/status') {
        void this.sendStatus(message.from);
        return;
      }

      if (text === '/help' || text === '/start') {
        void message.reply('OpenMac WhatsApp\nUse /status, /doctor, /queue, /sessions, /memory, /safe, /sandbox, /model, or send a task.');
        return;
      }

      if (text.startsWith('/')) {
        if (!this.handleAdminCommand) {
          void message.reply('OpenMac admin commands are not available right now.');
          return;
        }

        void this.handleAdminCommand({
          id: `whatsapp-admin-${Date.now()}`,
          source: 'whatsapp',
          sourceId: message.from,
          prompt: text,
        }, text).then((response) => {
          if (!response) {
            void message.reply('Unknown command. Use /help.');
            return;
          }

          void this.sendResponse(message.from, response);
        }).catch((error: any) => {
          logger.error(`WhatsApp admin command failed: ${error.message}`);
          void message.reply('OpenMac could not process that command.');
        });
        return;
      }

      void this.dispatch(message.body, message.from, {
        from: message.from,
        timestamp: message.timestamp,
      }).catch(async (error: any) => {
        logger.error(`WhatsApp dispatch failed: ${error.message}`);
        void message.reply('OpenMac could not queue that request right now.');
      });
    });

    await this.client.initialize();
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('WhatsApp client is not initialized.');
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3000)) {
      await this.client.sendMessage(to, chunk);
    }
  }

  private async sendStatus(to: string): Promise<void> {
    const lines = await getGatewayStatusLines(() => 'Unavailable', () => 'Unavailable');
    await this.sendResponse(to, lines.join('\n'));
  }

  private isAuthorized(chatId: string, authorId: string): boolean {
    return isWhatsAppMessageAuthorized(chatId, authorId, config.gateways.whatsapp);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
  }
}

export function createWhatsAppGateway(sink: GatewayTaskSink, handleAdminCommand?: AdminCommandHandler) {
  return new WhatsAppGateway(sink, handleAdminCommand);
}
