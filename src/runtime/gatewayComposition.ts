import { Orchestrator } from '../agent/orchestrator';
import { createSlackGateway } from '../gateways/slack';
import { createTelegramGateway } from '../gateways/telegram';
import { createWhatsAppGateway } from '../gateways/whatsapp';
import { AppContext } from './appContext';
import { GatewayTaskSink, AuthorizationRequester } from '../gateways/base';

export function composeGateways(orchestrator: Orchestrator, sink: GatewayTaskSink, appContext: AppContext, localAuthorizer: AuthorizationRequester) {
  let telegramGateway: ReturnType<typeof createTelegramGateway>;

  const approvalCounter = {
    getPendingApprovalCount: () => telegramGateway?.getPendingApprovalCount() ?? 0,
  };

  const whatsappGateway = createWhatsAppGateway(sink, appContext.adminCommands);
  telegramGateway = createTelegramGateway(sink, appContext.adminCommands);
  const slackGateway = createSlackGateway(sink, appContext.adminCommands);

  orchestrator.registerGateway('whatsapp', whatsappGateway);
  orchestrator.registerGateway('telegram', telegramGateway);
  orchestrator.registerGateway('slack', slackGateway);
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
      listPendingApprovals: () => [
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
      await Promise.all([
        whatsappGateway.start(),
        startTelegram ? telegramGateway.start() : Promise.resolve(),
        slackGateway.start(),
      ]);
    },
    async stopAll() {
      await whatsappGateway.stop();
      await telegramGateway.stop();
      await slackGateway.stop();
    },
  };
}
