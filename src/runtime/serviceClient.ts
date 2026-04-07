import { config } from '../config';
import { RuntimeStatusSnapshot } from './api';
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
