import { config } from '../config';
import { ollamaAudioTranscriptionProvider } from '../models/ollama';
import fs from 'fs/promises';
import path from 'path';

const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.ogg', '.mp3', '.m4a', '.wav']);

export function getTranscriptionSetupHint(): string {
  return 'Set OLLAMA_TRANSCRIPTION_MODEL or models.transcription in openmac.json to a local audio-capable transcription model.';
}

export async function validateAudioFileForTranscription(filePath: string): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported audio format ${extension || '(none)'}. Supported formats: ${Array.from(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`);
  }

  const stats = await fs.stat(filePath);
  if (stats.size > config.media.maxVoiceNoteBytes) {
    throw new Error(`Voice note exceeds ${config.media.maxVoiceNoteBytes} bytes.`);
  }
}

export async function transcribeAudioFile(filePath: string): Promise<string> {
  if (!config.models.transcription) {
    throw new Error(`Audio transcription is not configured yet. ${getTranscriptionSetupHint()}`);
  }

  await validateAudioFileForTranscription(filePath);

  return ollamaAudioTranscriptionProvider.transcribe(
    config.models.transcription,
    filePath,
    'Transcribe this audio message accurately. Return plain text only.'
  );
}
