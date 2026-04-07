import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';

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

  constructor(sink: GatewayTaskSink) {
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
      void this.dispatch(message.body, message.from, {
        from: message.from,
        timestamp: message.timestamp,
      });
    });

    await this.client.initialize();
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('WhatsApp client is not initialized.');
    }

    await this.client.sendMessage(to, text);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
  }
}

export function createWhatsAppGateway(sink: GatewayTaskSink) {
  return new WhatsAppGateway(sink);
}
