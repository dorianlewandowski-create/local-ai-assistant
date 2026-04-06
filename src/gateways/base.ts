import { TaskEnvelope, TaskSource } from '../types';

export interface GatewayTaskSink {
  enqueue(task: TaskEnvelope): Promise<unknown>;
}

export interface GatewayResponder {
  sendResponse(to: string, text: string): Promise<void>;
}

export abstract class GatewayProvider implements GatewayResponder {
  constructor(
    protected readonly source: TaskSource,
    protected readonly sink: GatewayTaskSink,
  ) {}

  protected dispatch(prompt: string, sourceId: string, metadata?: Record<string, unknown>) {
    return this.sink.enqueue({
      id: `${this.source}-${Date.now()}`,
      source: this.source,
      sourceId,
      prompt,
      metadata,
    });
  }

  abstract sendResponse(to: string, text: string): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}
