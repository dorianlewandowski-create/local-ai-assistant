import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GatewayProvider, GatewayTaskSink } from './base';
import { AuthorizationRequester, AuthorizationRequest } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';
import { TaskEnvelope } from '../types';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';
import { getGatewayStatusLines } from './status';
import { getOrCreatePairingCode } from '../security/channelPairingStore';
import { isWhatsAppMessageAuthorized } from './whatsappPolicy';
import { NativeApprovalManager } from './nativeApproval';
import { captureScreenshot, cleanupScreenshot } from './screenshot';
import { MessageMedia } from 'whatsapp-web.js';
import { cleanupTempFile, writeTempMediaFile } from '../media/files';
import { getTranscriptionSetupHint, transcribeAudioFile } from '../media/transcription';
import path from 'path';

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

export class WhatsAppGateway extends GatewayProvider implements AuthorizationRequester {
  private client: Client | null = null;
  private readonly approvals = new NativeApprovalManager();

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

      if (text === '/screen') {
        void this.sendScreen(message.from);
        return;
      }

      if (text.startsWith('/approve ')) {
        const approvalId = text.split(/\s+/, 2)[1];
        const settled = this.approvals.settle(approvalId, true);
        void message.reply(settled ? `Approved ${approvalId}.` : `Approval ${approvalId} was not found.`);
        return;
      }

      if (text.startsWith('/deny ')) {
        const approvalId = text.split(/\s+/, 2)[1];
        const settled = this.approvals.settle(approvalId, false);
        void message.reply(settled ? `Denied ${approvalId}.` : `Approval ${approvalId} was not found.`);
        return;
      }

      if (text === '/help' || text === '/start') {
        void message.reply('OpenMac WhatsApp\nUse /status, /screen, /doctor, /queue, /sessions, /memory, /safe, /sandbox, /model, or send a task.');
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

      if (message.hasMedia) {
        void this.handleMediaMessage(message);
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

  private async sendScreen(to: string): Promise<void> {
    if (!this.client) {
      throw new Error('WhatsApp client is not initialized.');
    }

    const imagePath = '/tmp/openmac-whatsapp-screen.png';
    try {
      await captureScreenshot(imagePath);
      const media = MessageMedia.fromFilePath(imagePath);
      await this.client.sendMessage(to, media, { caption: 'Current desktop snapshot' });
    } finally {
      await cleanupScreenshot(imagePath);
    }
  }

  private async handleMediaMessage(message: any): Promise<void> {
    let filePath: string | undefined;
    try {
      const media = await message.downloadMedia();
      if (!media?.data) {
        await message.reply('OpenMac could not download that media.');
        return;
      }

      const buffer = Buffer.from(media.data, 'base64');
      if (buffer.byteLength > config.media.maxTelegramFileBytes) {
        await message.reply(`OpenMac media limit exceeded. Max size is ${config.media.maxTelegramFileBytes} bytes.`);
        return;
      }

      const extension = this.getMediaExtension(media.mimetype, media.filename, message.type);
      filePath = await writeTempMediaFile('openmac-whatsapp-media', extension, buffer);

      if (message.type === 'audio' || message.type === 'ptt') {
        try {
          const transcript = await transcribeAudioFile(filePath);
          void this.dispatch(`The user sent a WhatsApp voice note. Transcript: ${transcript}`, message.from, {
            from: message.from,
            author: message.author,
            timestamp: message.timestamp,
            whatsappMediaType: message.type,
          }).catch(async (error: any) => {
            logger.error(`WhatsApp voice dispatch failed: ${error.message}`);
            await message.reply('OpenMac could not queue that voice note right now.');
          }).finally(async () => {
            await cleanupTempFile(filePath);
          });
          return;
        } catch (error: any) {
          await cleanupTempFile(filePath);
          await message.reply(`OpenMac received the voice note, but transcription is unavailable: ${error.message} ${getTranscriptionSetupHint()}`);
          return;
        }
      }

      const prompt = this.buildMediaPrompt(message.type, filePath);
      if (!prompt) {
        await cleanupTempFile(filePath);
        await message.reply('OpenMac does not support that WhatsApp media type yet.');
        return;
      }

      void this.dispatch(prompt, message.from, {
        from: message.from,
        author: message.author,
        timestamp: message.timestamp,
        whatsappMediaType: message.type,
        downloadedFilePath: filePath,
      }).catch(async (error: any) => {
        logger.error(`WhatsApp media dispatch failed: ${error.message}`);
        await cleanupTempFile(filePath);
        await message.reply('OpenMac could not queue that media for analysis right now.');
      });
    } catch (error: any) {
      await cleanupTempFile(filePath);
      logger.error(`WhatsApp media handling failed: ${error.message}`);
      await message.reply(`OpenMac could not process that media: ${error.message}`);
    }
  }

  private buildMediaPrompt(messageType: string, filePath: string): string | null {
    if (messageType === 'image') {
      return `Analyze this WhatsApp image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`;
    }

    if (messageType === 'document') {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === '.pdf') {
        return `Read this WhatsApp PDF immediately using read_pdf_content with path "${filePath}". Summarize the important contents and recommend the next best action.`;
      }

      if (['.jpg', '.jpeg', '.png'].includes(extension)) {
        return `Analyze this WhatsApp image immediately using analyze_image_content with path "${filePath}". Describe what is important, extract any visible text if relevant, and recommend the next best action.`;
      }

      return `Read this WhatsApp file immediately using read_text_file with path "${filePath}". Summarize the important contents and recommend the next best action.`;
    }

    return null;
  }

  private getMediaExtension(mimeType: string | undefined, filename: string | undefined, messageType: string): string {
    const byFilename = filename ? path.extname(filename).toLowerCase() : '';
    if (byFilename) {
      return byFilename;
    }

    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'application/pdf':
        return '.pdf';
      case 'audio/ogg; codecs=opus':
      case 'audio/ogg':
        return '.ogg';
      case 'audio/mpeg':
        return '.mp3';
      default:
        return messageType === 'audio' || messageType === 'ptt' ? '.ogg' : '.bin';
    }
  }

  private isAuthorized(chatId: string, authorId: string): boolean {
    return isWhatsAppMessageAuthorized(chatId, authorId, config.gateways.whatsapp);
  }

  async stop(): Promise<void> {
    this.approvals.stop();
    await this.client?.destroy();
    this.client = null;
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.client || !request.sourceId) {
      throw new Error('WhatsApp authorization requested but client is not initialized or sourceId is missing.');
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
      );
    });
  }
}

export function createWhatsAppGateway(sink: GatewayTaskSink, handleAdminCommand?: AdminCommandHandler) {
  return new WhatsAppGateway(sink, handleAdminCommand);
}
