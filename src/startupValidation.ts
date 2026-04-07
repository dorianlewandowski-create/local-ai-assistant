import fs from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import { config, OpenMacConfig } from './config';

function ensureLocalOllamaHost(ollamaHost: string) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(ollamaHost)) {
    throw new Error(`Ollama must be local-only. Invalid OLLAMA_HOST: ${ollamaHost}`);
  }
}

function commandExists(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function verifyOllamaConnection(ollamaHost: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(new URL('/api/tags', ollamaHost), {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama health check failed with status ${response.status}`);
    }
  } catch (error: any) {
    const message = error?.name === 'AbortError'
      ? 'Ollama health check timed out after 3s'
      : error?.message || 'Unknown Ollama connection error';
    throw new Error(`Unable to reach Ollama at ${ollamaHost}. ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function validateVectorStorePath(activeConfig: OpenMacConfig): string[] {
  const warnings: string[] = [];
  const vectorStorePath = activeConfig.storage.vectorStorePath;

  if (vectorStorePath.startsWith('/Volumes/') && !fs.existsSync(vectorStorePath)) {
    throw new Error('🚨 VAULT NOT FOUND: Please mount your encrypted OpenMacData volume to continue.');
  }

  try {
    fs.mkdirSync(vectorStorePath, { recursive: true });
    fs.accessSync(vectorStorePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    warnings.push(`Configured VECTOR_STORE_PATH is not writable: ${vectorStorePath}. OpenMac will fall back to the local data directory.`);
  }

  return warnings;
}

export async function validateStartup(activeConfig: OpenMacConfig = config): Promise<string[]> {
  if (os.platform() !== 'darwin') {
    throw new Error('OpenMac requires macOS.');
  }

  ensureLocalOllamaHost(activeConfig.ollama.host);

  const missingRequiredCommands = ['osascript', 'screencapture'].filter((command) => !commandExists(command));
  if (missingRequiredCommands.length > 0) {
    throw new Error(`Missing required macOS commands: ${missingRequiredCommands.join(', ')}`);
  }

  const warnings = [
    ...validateVectorStorePath(activeConfig),
  ];

  const missingOptionalCommands = ['pmset', 'uptime'].filter((command) => !commandExists(command));
  if (missingOptionalCommands.length > 0) {
    warnings.push(`Optional commands unavailable: ${missingOptionalCommands.join(', ')}. Some status features may be limited.`);
  }

  if (activeConfig.gateways.telegram.enabled) {
    if (!activeConfig.gateways.telegram.botToken || !activeConfig.gateways.telegram.chatId) {
      throw new Error('Telegram is enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.');
    }
  }

  if (activeConfig.gateways.whatsapp.enabled && activeConfig.gateways.whatsapp.executablePath && !fs.existsSync(activeConfig.gateways.whatsapp.executablePath)) {
    warnings.push(`Configured PUPPETEER_EXECUTABLE_PATH does not exist: ${activeConfig.gateways.whatsapp.executablePath}`);
  }

  await verifyOllamaConnection(activeConfig.ollama.host);

  return warnings;
}
