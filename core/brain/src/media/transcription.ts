import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'

const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.ogg', '.mp3', '.m4a', '.wav'])

export type AudioTranscriber = (model: string, filePath: string, prompt: string) => Promise<string>

export interface TranscriptionDeps {
  transcribe: AudioTranscriber
}

export function getTranscriptionSetupHint(): string {
  return 'Set OLLAMA_TRANSCRIPTION_MODEL or models.transcription in apex.json to a local audio-capable transcription model.'
}

export async function validateAudioFileForTranscription(
  filePath: string,
  maxBytes = config.media.maxVoiceNoteBytes,
): Promise<void> {
  const extension = path.extname(filePath).toLowerCase()
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported audio format ${extension || '(none)'}. Supported formats: ${Array.from(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`,
    )
  }

  const stats = await fs.stat(filePath)
  if (stats.size > maxBytes) {
    throw new Error(`Voice note exceeds ${maxBytes} bytes.`)
  }
}

export async function transcribeAudioFile(
  filePath: string,
  deps: TranscriptionDeps,
  options: { model?: string; maxBytes?: number } = {},
): Promise<string> {
  const model = options.model ?? config.models.transcription
  if (!model) {
    throw new Error(`Audio transcription is not configured yet. ${getTranscriptionSetupHint()}`)
  }

  await validateAudioFileForTranscription(filePath, options.maxBytes ?? config.media.maxVoiceNoteBytes)

  return deps.transcribe(model, filePath, 'Transcribe this audio message accurately. Return plain text only.')
}
