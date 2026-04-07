import { config } from '../config';
import { RuntimeApprovalSummary, RuntimeStatusSnapshot } from './api';
import { TaskEnvelope } from '../types';

async function postJson(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Runtime service request failed with status ${response.status}`);
  }

  return await response.json();
}

export function createRuntimeServiceClient(baseUrl = `http://127.0.0.1:${config.runtimeService.port}`) {
  return {
    async getStatusSnapshot(): Promise<RuntimeStatusSnapshot> {
      const response = await fetch(`${baseUrl}/api/status`);
      if (!response.ok) {
        throw new Error(`Runtime service request failed with status ${response.status}`);
      }

      return await response.json() as RuntimeStatusSnapshot;
    },
    getBaseUrl(): string {
      return baseUrl;
    },
    async submitPrompt(source: TaskEnvelope['source'], sourceId: string, prompt: string): Promise<string> {
      const result = await postJson(baseUrl, '/api/prompt', { source, sourceId, prompt });
      return String(result.response || '');
    },
    async listSessions(): Promise<any[]> {
      const response = await fetch(`${baseUrl}/api/sessions`);
      if (!response.ok) {
        throw new Error(`Runtime service request failed with status ${response.status}`);
      }
      return await response.json() as any[];
    },
    async listPendingApprovals(): Promise<RuntimeApprovalSummary[]> {
      const response = await fetch(`${baseUrl}/api/approvals`);
      if (!response.ok) {
        throw new Error(`Runtime service request failed with status ${response.status}`);
      }
      return await response.json() as RuntimeApprovalSummary[];
    },
    async settleApproval(id: string, approved: boolean): Promise<boolean> {
      const result = await postJson(baseUrl, '/api/approvals/settle', { id, approved });
      return Boolean(result.ok);
    },
    async setRemoteSafeMode(enabled: boolean): Promise<void> {
      await postJson(baseUrl, '/api/control/remote-safe', { enabled });
    },
    async setSessionModel(source: TaskEnvelope['source'], sourceId: string, model: string): Promise<void> {
      await postJson(baseUrl, '/api/control/session-model', { source, sourceId, model });
    },
    async setSessionSandboxMode(source: TaskEnvelope['source'], sourceId: string, mode: 'default' | 'strict' | 'off'): Promise<void> {
      await postJson(baseUrl, '/api/control/session-sandbox', { source, sourceId, mode });
    },
  };
}
