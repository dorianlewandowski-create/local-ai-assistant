import { WebClient } from '@slack/web-api';
import { GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';

export class SlackGateway extends GatewayProvider {
  private client: WebClient | null = null;

  constructor(sink: GatewayTaskSink) {
    super('slack', sink);
  }

  async start(): Promise<void> {
    if (!config.gateways.slack.botToken) {
      logger.debug('Slack disabled: missing SLACK_BOT_TOKEN');
      return;
    }

    this.client = new WebClient(config.gateways.slack.botToken);
    logger.warn('Slack send-only mode initialized. Incoming events, approvals, and rich parity are not wired yet.');
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('Slack client is not initialized.');
    }

    for (const chunk of chunkRemoteResponse(formatRemoteAssistantText(text), 3500)) {
      await this.client.chat.postMessage({
        channel: to,
        text: chunk,
      });
    }
  }

  async stop(): Promise<void> {
    this.client = null;
  }
}

export function createSlackGateway(sink: GatewayTaskSink) {
  return new SlackGateway(sink);
}
