import { App } from '@slack/bolt';
import { AuthorizationRequester, AuthorizationRequest, GatewayProvider, GatewayTaskSink } from './base';
import { logger } from '../utils/logger';
import { config } from '../config';
import { chunkRemoteResponse, formatRemoteAssistantText } from './responseFormatting';
import { TaskEnvelope } from '../types';
import { getOrCreatePairingCode, isChannelSubjectApproved } from '../security/channelPairingStore';
import { NativeApprovalManager, PendingApprovalSummary } from './nativeApproval';
import { captureScreenshot, cleanupScreenshot } from './screenshot';
import fs from 'fs';
import { buildSlackHelpText, buildSlackStatusText } from './slackDiagnostics';

type AdminCommandHandler = (task: TaskEnvelope, input: string) => Promise<string | null>;

export class SlackGateway extends GatewayProvider implements AuthorizationRequester {
  private app: App | null = null;
  private readonly approvals = new NativeApprovalManager();

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
        await this.sendResponse(message.channel, buildSlackStatusText(config));
        return;
      }

      if (text === '/screen') {
        await this.sendScreen(message.channel);
        return;
      }

      if (text.startsWith('/approve ')) {
        const approvalId = text.split(/\s+/, 2)[1];
        await this.sendResponse(message.channel, this.approvals.settle(approvalId, true) ? `Approved ${approvalId}.` : `Approval ${approvalId} was not found.`);
        return;
      }

      if (text.startsWith('/deny ')) {
        const approvalId = text.split(/\s+/, 2)[1];
        await this.sendResponse(message.channel, this.approvals.settle(approvalId, false) ? `Denied ${approvalId}.` : `Approval ${approvalId} was not found.`);
        return;
      }

      if (text === '/help' || text === '/start') {
        await this.sendResponse(message.channel, buildSlackHelpText());
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
    this.approvals.stop();
    await this.app?.stop();
    this.app = null;
  }

  getPendingApprovalCount(): number {
    return this.approvals.getPendingCount();
  }

  listPendingApprovals(): PendingApprovalSummary[] {
    return this.approvals.listPending();
  }

  settleApproval(id: string, approved: boolean): boolean {
    return this.approvals.settle(id, approved);
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    if (!this.app || !request.sourceId) {
      throw new Error('Slack authorization requested but app is not initialized or sourceId is missing.');
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

  private isAuthorized(userId: string): boolean {
    return isChannelSubjectApproved('slack', userId, config.gateways.slack.allowFrom);
  }

  private async sendScreen(channel: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack app is not initialized.');
    }

    const imagePath = '/tmp/openmac-slack-screen.png';
    try {
      await captureScreenshot(imagePath);
      const fileContent = fs.readFileSync(imagePath);
      await this.app.client.files.uploadV2({
        channel_id: channel,
        filename: 'openmac-screen.png',
        title: 'Current desktop snapshot',
        file: fileContent,
      });
    } finally {
      await cleanupScreenshot(imagePath);
    }
  }
}

export function createSlackGateway(sink: GatewayTaskSink, handleAdminCommand?: AdminCommandHandler) {
  return new SlackGateway(sink, handleAdminCommand);
}
