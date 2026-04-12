import type { AuthorizationRequest, TaskSource } from '@apex/types'

export type { AuthorizationRequest } from '@apex/types'

export interface RuntimeSubmissionClient {
  submitPrompt(
    source: TaskSource,
    sourceId: string,
    prompt: string,
    metadata?: Record<string, any>,
  ): Promise<string>
}

export interface GatewayResponder {
  sendResponse(to: string, text: string): Promise<void>
}

export interface AuthorizationRequester {
  requestAuthorization(request: AuthorizationRequest): Promise<boolean>
}

export interface GatewayLogger {
  debug(message: string): void
  system(message: string): void
  warn(message: string): void
  error(message: string): void
  chat?(role: 'user' | 'assistant', message: string): void
}

export const defaultGatewayLogger: GatewayLogger = {
  debug: (m) => console.log(m),
  system: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  chat: (_role, message) => console.log(message),
}

export abstract class GatewayProvider implements GatewayResponder {
  constructor(
    protected readonly source: TaskSource,
    protected readonly client: RuntimeSubmissionClient,
  ) {}

  protected async dispatch(
    prompt: string,
    sourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return await this.client.submitPrompt(this.source, sourceId, prompt, metadata)
  }

  abstract sendResponse(to: string, text: string): Promise<void>
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
}
