import { createTuiClient } from './tuiClient';
import { createRuntimeServiceClient } from '../runtime/serviceClient';
import { RuntimeApprovalSummary } from '../runtime/api';
import { logger, MonologueKind, ChatRole } from '../utils/logger';
import { AuthorizationRequest } from '../types';

export function createRemoteTuiClient() {
  const { tui, destroy } = createTuiClient();
  const client = createRuntimeServiceClient();

  let statusInterval: NodeJS.Timeout | null = null;
  let approvalInterval: NodeJS.Timeout | null = null;
  let stopLogStream: (() => void) | null = null;
  const knownApprovals = new Set<string>();

  const updateStatus = async () => {
    try {
      const snapshot = await client.getStatusSnapshot();
      const pulse = snapshot.queue.active > 0 ? '•' : '●';
      const mode = snapshot.health.remoteSafeMode ? 'SAFE' : 'FAST-PATH';
      const statusLine = `${pulse}  OPENMAC ${snapshot.health.version} | VAULT: LOCKED | AI: ${snapshot.health.ollamaHost} | Q:${snapshot.queue.active}/${snapshot.queue.pending} | MODE: ${mode}`;
      tui.setStatus(statusLine);
    } catch (error: any) {
      tui.setStatus(` OFFLINE | Error: ${error.message}`);
    }
  };

  const pollApprovals = async () => {
    try {
      const approvals = await client.listPendingApprovals();
      for (const approval of approvals) {
        if (!knownApprovals.has(approval.id)) {
          knownApprovals.add(approval.id);
          void handleRemoteApproval(approval);
        }
      }
    } catch (error: any) {
      // Ignore polling errors
    }
  };

  const handleRemoteApproval = async (request: RuntimeApprovalSummary) => {
    const approved = await tui.requestAuthorization(request as any);
    try {
      await client.settleApproval(request.id, approved);
      knownApprovals.delete(request.id);
    } catch (error: any) {
      logger.error(`Failed to settle remote approval ${request.id}: ${error.message}`);
    }
  };

  return {
    tui,
    attach() {
      tui.onSubmit(async (value) => {
        if (value.trim() === '/exit') {
          process.exit(0);
        }

        try {
          const response = await client.submitPrompt('terminal', 'remote-console', value);
          // If response is received here, it might be an admin command or a direct response.
          // Assistant chat messages will also come via the log stream.
          if (response && !value.startsWith('/')) {
            // Already handled by log stream if it's a chat message
          } else if (response) {
            logger.chat('assistant', response);
          }
        } catch (error: any) {
          logger.error(`Remote prompt failed: ${error.message}`);
        }
      });

      tui.onExit(() => {
        process.exit(0);
      });

      stopLogStream = client.streamLogs((entry) => {
        if (entry.channel === 'STATUS') {
          tui.setStatus(entry.message);
        } else if (entry.channel === 'USER' || entry.channel === 'ASSISTANT') {
          tui.appendChat(entry.channel.toLowerCase() as ChatRole, entry.message);
        } else {
          tui.appendMonologue(entry.channel.toLowerCase() as MonologueKind, entry.message);
        }
      });
      
      statusInterval = setInterval(updateStatus, 5000);
      approvalInterval = setInterval(pollApprovals, 2000);
      void updateStatus();
    },
    async runInitialPrompt(prompt: string) {
      try {
        const response = await client.submitPrompt('terminal', 'remote-console', prompt);
        if (response) {
          logger.chat('assistant', response);
        }
      } catch (error: any) {
        logger.error(`Initial remote prompt failed: ${error.message}`);
      }
    },
    destroy() {
      if (statusInterval) clearInterval(statusInterval);
      if (approvalInterval) clearInterval(approvalInterval);
      if (stopLogStream) stopLogStream();
      destroy();
    },
  };
}
