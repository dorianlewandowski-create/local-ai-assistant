import ollama from 'ollama';
import { AudioTranscriptionProvider, ChatCompletionRequest, ChatCompletionResponse, ChatModelProvider, EmbeddingModelProvider, VisionModelProvider } from './provider';

export class OllamaChatProvider implements ChatModelProvider {
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await ollama.chat({
      model: request.model,
      messages: request.messages as any,
      tools: request.tools as any,
    });

    return {
      message: {
        role: 'assistant',
        content: response.message.content,
        tool_calls: response.message.tool_calls as any,
      },
    };
  }
}

export class OllamaEmbeddingProvider implements EmbeddingModelProvider {
  async embed(model: string, input: string): Promise<number[]> {
    const response = await ollama.embed({ model, input });
    return Array.from(response.embeddings[0] ?? []);
  }
}

export class OllamaVisionProvider implements VisionModelProvider {
  async analyzeImage(model: string, imagePath: string, prompt: string): Promise<string> {
    const response = await ollama.chat({
      model,
      messages: [{
        role: 'user',
        content: prompt,
        images: [imagePath],
      }] as any,
    });

    return response.message.content.trim();
  }
}

export class OllamaAudioTranscriptionProvider implements AudioTranscriptionProvider {
  async transcribe(model: string, audioPath: string, prompt: string): Promise<string> {
    const response = await ollama.chat({
      model,
      messages: [{
        role: 'user',
        content: prompt,
        images: [audioPath],
      }] as any,
    });

    return response.message.content.trim();
  }
}

export const ollamaChatProvider = new OllamaChatProvider();
export const ollamaEmbeddingProvider = new OllamaEmbeddingProvider();
export const ollamaVisionProvider = new OllamaVisionProvider();
export const ollamaAudioTranscriptionProvider = new OllamaAudioTranscriptionProvider();
