import { Orchestrator } from '../agent/orchestrator'
import { createSlackGateway } from '@apex/gateway-slack'
import { createTelegramGateway } from '@apex/gateway-telegram'
import { createWhatsAppGateway } from '@apex/gateway-whatsapp'
import { createDiscordGateway } from '@apex/gateway-discord'
import { AppContext } from './appContext'
import { AuthorizationRequester } from '../gateways/base'
import { PendingApprovalSummary } from '../gateways/nativeApproval'
import { createRuntimeServiceClient, type RuntimeServiceClientOptions } from './serviceClient'
import { config } from '@apex/core'
import { logger } from '../utils/logger'
import { recordEnergyImpact } from '../utils/energyImpact'
import { ollamaAudioTranscriptionProvider } from '../models/ollama'

export function composeGateways(
  orchestrator: Orchestrator,
  appContext: AppContext,
  localAuthorizer: AuthorizationRequester,
  serviceClientOpts?: RuntimeServiceClientOptions,
) {
  let telegramGateway: ReturnType<typeof createTelegramGateway>
  const serviceClient = createRuntimeServiceClient(
    `http://127.0.0.1:${config.runtimeService.port}`,
    serviceClientOpts,
  )

  const gatewayDeps = {
    config,
    logger,
    energyImpact: { recordEnergyImpact },
    transcriber: (model: string, audioPath: string, prompt: string) =>
      ollamaAudioTranscriptionProvider.transcribe(model, audioPath, prompt),
  }

  const whatsappGateway = createWhatsAppGateway(serviceClient, gatewayDeps)
  telegramGateway = createTelegramGateway(serviceClient, gatewayDeps)
  const slackGateway = createSlackGateway(serviceClient, gatewayDeps)
  const discordGateway = createDiscordGateway(serviceClient, gatewayDeps)

  orchestrator.registerAuthorizer('telegram', telegramGateway)
  orchestrator.registerAuthorizer('whatsapp', whatsappGateway)
  orchestrator.registerAuthorizer('slack', slackGateway)
  orchestrator.registerAuthorizer('discord', discordGateway)
  orchestrator.registerAuthorizer('terminal', localAuthorizer)
  orchestrator.registerAuthorizer('file_watcher', localAuthorizer)
  orchestrator.registerAuthorizer('scheduler', localAuthorizer)
  orchestrator.registerAuthorizer('default', localAuthorizer)

  const approvalCounter = {
    getPendingApprovalCount: () =>
      (telegramGateway.getPendingApprovalCount() ?? 0) +
      (whatsappGateway.getPendingApprovalCount() ?? 0) +
      (slackGateway.getPendingApprovalCount() ?? 0) +
      (discordGateway.getPendingApprovalCount() ?? 0),
  }

  return {
    approvalCounter: {
      getPendingApprovalCount: () => approvalCounter.getPendingApprovalCount(),
      listPendingApprovals: (): PendingApprovalSummary[] => [
        ...telegramGateway.listPendingApprovals(),
        ...whatsappGateway.listPendingApprovals(),
        ...slackGateway.listPendingApprovals(),
        ...discordGateway.listPendingApprovals(),
      ],
      settleApproval: (id: string, approved: boolean) => {
        return (
          telegramGateway.settleApproval(id, approved) ||
          whatsappGateway.settleApproval(id, approved) ||
          slackGateway.settleApproval(id, approved) ||
          discordGateway.settleApproval(id, approved)
        )
      },
    },
    async startAll(startTelegram: boolean) {
      // Start in background to avoid blocking total app startup on slow gateways
      void whatsappGateway.start().catch((err) => logger.error(`WhatsApp start failed: ${err.message}`))
      if (startTelegram) {
        void telegramGateway.start().catch((err) => logger.error(`Telegram start failed: ${err.message}`))
      }
      void slackGateway.start().catch((err) => logger.error(`Slack start failed: ${err.message}`))
      void discordGateway.start().catch((err) => logger.error(`Discord start failed: ${err.message}`))
    },
    async stopAll() {
      await whatsappGateway.stop()
      await telegramGateway.stop()
      await slackGateway.stop()
      await discordGateway.stop()
    },
  }
}
