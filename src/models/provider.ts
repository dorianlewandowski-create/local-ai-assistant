import { Message, ToolCall } from '../types';

export interface ChatToolDefinition {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface ChatMessageInput {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessageInput[];
  tools?: ChatToolDefinition[];
}

export interface ChatCompletionResponse {
  message: Message;
}

export interface ChatModelProvider {
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export interface EmbeddingModelProvider {
  embed(model: string, input: string): Promise<number[]>;
}

export interface VisionModelProvider {
  analyzeImage(model: string, imagePath: string, prompt: string): Promise<string>;
}
