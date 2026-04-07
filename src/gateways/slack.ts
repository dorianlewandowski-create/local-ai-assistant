import { App } from '@slack/bolt';
import { GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';
import { TaskEnvelope } from '../types';
import { getOrCreatePairingCode, isChannelSubjectApproved } from '../security/channelPairingStore';

type AdminCommandHandler = (task: TaskEnvelope, input: string) => Promise<string | null>;

export class SlackGateway extends GatewayProvider {
  private app: App | null = null;

  constructor(sink: GatewayTaskSink, private readonly handleAdminCommand?: AdminCommandHandler) {
    super('slack', sink);
  }

  async start(): Promise<void> {
    if (!config.gateways.slack.enabled && !config.gateways.slack.botToken) {
      logger.debug('Slack disabled');
      return;
    }

    if (!config.gateways.slack.botToken || !config.gateways.slack.appToken) {
      logger.warn('Slack inbound requires SLACK_BOT_TOKEN and SLACK_APP_TOKEN. Slack remains disabled.');
      return;
    }

    this.app = new App({
      token: config.gateways.slack.botToken,
      appToken: config.gateways.slack.appToken,
      socketMode: true,
    });

    this.app.event('message', async ({ event, client, say }) => {
      const message = event as any;
      if (message.channel_type !== 'im' || !message.user || !message.text) {
        return;
      }

      const text = String(message.text).trim();
      if (!text) {
        return;
      }

      if (!this.isAuthorized(message.user)) {
        const { code } = getOrCreatePairingCode('slack', message.user);
        await say(`OpenMac Slack is not paired for this DM yet. Pairing code: ${code}. Approve locally with: openmac pairing approve slack ${code}`);
        return;
      }

      if (text === '/status') {
        await this.sendResponse(message.channel, 'OpenMac Slack DM is connected. Use /doctor, /queue, /sessions, /memory, /safe, /sandbox, /model, or send a task.');
        return;
      }

      if (text === '/help' || text === '/start') {
        await this.sendResponse(message.channel, 'OpenMac Slack\nUse /status, /doctor, /queue, /sessions, /memory, /safe, /sandbox, /model, or send a task.');
        return;
      }

      if (text.startsWith('/')) {
        if (!this.handleAdminCommand) {
          await this.sendResponse(message.channel, 'OpenMac admin commands are not available right now.');
          return;
        }

        const response = await this.handleAdminCommand({
          id: `slack-admin-${Date.now()}`,
          source: 'slack',
          sourceId: message.channel,
          prompt: text,
        }, text);

        await this.sendResponse(message.channel, response || 'Unknown command. Use /help.');
        return;
      }

      void this.dispatch(text, message.channel, {
        slackUserId: message.user,
        slackChannelId: message.channel,
      }).catch(async (error: any) => {
        logger.error(`Slack dispatch failed: ${error.message}`);
        await this.sendResponse(message.channel, 'OpenMac could not queue that request right now.');
      });
    });

    await this.app.start();
    logger.system('Slack Socket Mode DM support initialized');
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack client is not initialized.');
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3500)) {
      await this.app.client.chat.postMessage({
        channel: to,
        text: chunk,
      });
    }
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    this.app = null;
  }

  private isAuthorized(userId: string): boolean {
    return isChannelSubjectApproved('slack', userId, config.gateways.slack.allowFrom);
  }
}

export function createSlackGateway(sink: GatewayTaskSink, handleAdminCommand?: AdminCommandHandler) {
  return new SlackGateway(sink, handleAdminCommand);
}
