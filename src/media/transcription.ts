import { config } from '../config';
import { ollamaAudioTranscriptionProvider } from '../models/ollama';

export async function transcribeAudioFile(filePath: string): Promise<string> {
  if (!config.models.transcription) {
    throw new Error('Audio transcription is not configured yet. Set OLLAMA_TRANSCRIPTION_MODEL.');
  }

  return ollamaAudioTranscriptionProvider.transcribe(
    config.models.transcription,
    filePath,
    'Transcribe this audio message accurately. Return plain text only.'
  );
}
