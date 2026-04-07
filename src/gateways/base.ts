import { AuthorizationRequest, TaskEnvelope, TaskSource } from '../types';

export type { AuthorizationRequest } from '../types';

export interface RuntimeSubmissionClient {
  submitPrompt(source: TaskSource, sourceId: string, prompt: string, metadata?: Record<string, any>): Promise<string>;
}

export interface GatewayResponder {
  sendResponse(to: string, text: string): Promise<void>;
}

export interface AuthorizationRequester {
  requestAuthorization(request: AuthorizationRequest): Promise<boolean>;
}

export abstract class GatewayProvider implements GatewayResponder {
  constructor(
    protected readonly source: TaskSource,
    protected readonly client: RuntimeSubmissionClient,
  ) {}

  protected async dispatch(prompt: string, sourceId: string, metadata?: Record<string, unknown>): Promise<string> {
    return await this.client.submitPrompt(this.source, sourceId, prompt, metadata);
  }

  abstract sendResponse(to: string, text: string): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}
