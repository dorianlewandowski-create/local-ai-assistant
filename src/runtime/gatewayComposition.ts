import { Orchestrator } from '../agent/orchestrator';
import { createSlackGateway } from '../gateways/slack';
import { createTelegramGateway } from '../gateways/telegram';
import { createWhatsAppGateway } from '../gateways/whatsapp';
import { AppContext } from './appContext';
import { AuthorizationRequester } from '../gateways/base';
import { PendingApprovalSummary } from '../gateways/nativeApproval';
import { createRuntimeServiceClient } from './serviceClient';
import { config } from '../config';
import { logger } from '../utils/logger';

export function composeGateways(orchestrator: Orchestrator, appContext: AppContext, localAuthorizer: AuthorizationRequester) {
  let telegramGateway: ReturnType<typeof createTelegramGateway>;
  const serviceClient = createRuntimeServiceClient(`http://127.0.0.1:${config.runtimeService.port}`);

  const approvalCounter = {
    getPendingApprovalCount: () => telegramGateway?.getPendingApprovalCount() ?? 0,
  };

  const whatsappGateway = createWhatsAppGateway(serviceClient);
  telegramGateway = createTelegramGateway(serviceClient);
  const slackGateway = createSlackGateway(serviceClient);

  orchestrator.registerAuthorizer('telegram', telegramGateway);
  orchestrator.registerAuthorizer('whatsapp', whatsappGateway);
  orchestrator.registerAuthorizer('slack', slackGateway);
  orchestrator.registerAuthorizer('terminal', localAuthorizer);
  orchestrator.registerAuthorizer('file_watcher', localAuthorizer);
  orchestrator.registerAuthorizer('scheduler', localAuthorizer);
  orchestrator.registerAuthorizer('default', localAuthorizer);

  return {
    approvalCounter: {
      getPendingApprovalCount: () => approvalCounter.getPendingApprovalCount(),
      listPendingApprovals: (): PendingApprovalSummary[] => [
        ...telegramGateway.listPendingApprovals(),
        ...whatsappGateway.listPendingApprovals(),
        ...slackGateway.listPendingApprovals(),
      ],
      settleApproval: (id: string, approved: boolean) => {
        return telegramGateway.settleApproval(id, approved)
          || whatsappGateway.settleApproval(id, approved)
          || slackGateway.settleApproval(id, approved);
      },
    },
    async startAll(startTelegram: boolean) {
      // Start in background to avoid blocking total app startup on slow gateways
      void whatsappGateway.start().catch((err) => logger.error(`WhatsApp start failed: ${err.message}`));
      if (startTelegram) {
        void telegramGateway.start().catch((err) => logger.error(`Telegram start failed: ${err.message}`));
      }
      void slackGateway.start().catch((err) => logger.error(`Slack start failed: ${err.message}`));
    },
    async stopAll() {
      await whatsappGateway.stop();
      await telegramGateway.stop();
      await slackGateway.stop();
    },
  };
}
