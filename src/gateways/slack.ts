import { WebClient } from '@slack/web-api';
import { GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';

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
    logger.system('Slack skeleton initialized; event subscription wiring is pending');
  }

  async sendResponse(to: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('Slack client is not initialized.');
    }

    await this.client.chat.postMessage({
      channel: to,
      text,
    });
  }

  async stop(): Promise<void> {
    this.client = null;
  }
}

export function createSlackGateway(sink: GatewayTaskSink) {
  return new SlackGateway(sink);
}
