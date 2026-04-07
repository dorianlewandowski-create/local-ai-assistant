import { runDoctor } from '../doctor';
import { TaskEnvelope } from '../types';
import { TaskQueue } from './taskQueue';
import { RuntimeServices } from './services';
import { RuntimeApi } from './api';

export interface ApprovalStatusProvider {
  getPendingApprovalCount(): number;
}

export interface AdminCommandDependencies {
  taskQueue: TaskQueue;
  approvals?: ApprovalStatusProvider;
  services: RuntimeServices;
  api: RuntimeApi;
}

function parseSlashCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const [name, ...args] = trimmed.slice(1).split(/\s+/).filter(Boolean);
  return name ? { name: name.toLowerCase(), args } : null;
}

function isRemoteSource(source: TaskEnvelope['source']): boolean {
  return source === 'telegram' || source === 'slack' || source === 'whatsapp';
}

export function createAdminCommandHandler(dependencies: AdminCommandDependencies) {
  return async function handleAdminCommand(task: TaskEnvelope, input: string): Promise<string | null> {
    const command = parseSlashCommand(input);
    if (!command) {
      return null;
    }

    switch (command.name) {
      case 'doctor': {
        const lines: string[] = [];
        await runDoctor((line) => lines.push(line));
        return lines.join('\n');
      }
      case 'queue': {
        const snapshot = dependencies.taskQueue.getSnapshot();
        const queues = snapshot.queues.length === 0
          ? 'No active or pending queues.'
          : snapshot.queues.map((queue) => `- ${queue.key}: active=${queue.active} pending=${queue.pending}`).join('\n');
        return [`Queue status`, `Active: ${snapshot.active}`, `Pending: ${snapshot.pending}`, queues].join('\n');
      }
      case 'sessions': {
        const sessions = dependencies.services.listSessions(10);
        if (sessions.length === 0) {
          return 'No persisted sessions.';
        }

        return [
          `Sessions: ${dependencies.services.getSessionCount()}`,
          ...sessions.map((session) => `- ${session.key} | history=${session.historyCount} | updated=${session.updatedAt}`),
        ].join('\n');
      }
      case 'memory': {
        const vectorCount = await dependencies.services.countVectors();
        return [
          'Memory status',
          `Facts: ${dependencies.services.countFacts()}`,
          `Vector entries: ${vectorCount}`,
          `Session records: ${dependencies.services.getSessionCount()}`,
        ].join('\n');
      }
      case 'safe': {
        const mode = command.args[0]?.toLowerCase();
        if (isRemoteSource(task.source)) {
          return 'Remote-safe mode can only be changed from the local terminal.';
        }
        if (mode === 'on') {
          dependencies.api.setRemoteSafeMode(true);
          return 'Remote-safe mode enabled.';
        }
        if (mode === 'off') {
          dependencies.api.setRemoteSafeMode(false);
          return 'Remote-safe mode disabled.';
        }
        return `Remote-safe mode is ${dependencies.api.isRemoteSafeModeEnabled() ? 'on' : 'off'}. Use /safe on or /safe off.`;
      }
      case 'sandbox': {
        const mode = command.args[0]?.toLowerCase();
        if (isRemoteSource(task.source) && mode) {
          return 'Remote sessions cannot change sandbox mode remotely. View-only access is allowed.';
        }
        if (mode === 'strict') {
          dependencies.api.setSessionSandboxMode(task, 'strict');
          return 'Session sandbox mode set to strict.';
        }
        if (mode === 'off') {
          dependencies.api.setSessionSandboxMode(task, 'off');
          return 'Session sandbox mode disabled.';
        }
        if (mode === 'default') {
          dependencies.api.setSessionSandboxMode(task, 'default');
          return 'Session sandbox mode reset to default.';
        }

        return `Session sandbox mode is ${dependencies.api.getSessionSandboxMode(task) || 'default'}. Use /sandbox strict, /sandbox off, or /sandbox default.`;
      }
      case 'model': {
        const selectedModel = command.args.join(' ').trim();
        if (isRemoteSource(task.source) && selectedModel) {
          return 'Remote sessions cannot change the model remotely. View-only access is allowed.';
        }
        if (selectedModel) {
          dependencies.api.setSessionModel(task, selectedModel);
          return `Session model set to ${selectedModel}.`;
        }

        return `Session model is ${dependencies.api.getSessionModel(task) || 'default'}.`;
      }
      case 'approvals': {
        const pending = dependencies.approvals?.getPendingApprovalCount() ?? 0;
        return [
          'Approval status',
          `Pending approvals: ${pending}`,
          'Remote approvals are currently implemented for Telegram.',
        ].join('\n');
      }
      default:
        return null;
    }
  };
}
