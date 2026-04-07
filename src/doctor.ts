import { config } from './config';
import { validateStartup } from './startupValidation';
import { existsSync } from 'fs';
import { getLaunchdPlistPath } from './launchd';

export async function runDoctor(write: (line: string) => void = console.log): Promise<number> {
  write('OpenMac Doctor');
  write(`Config file: ${config.meta.configPath ?? 'none'}`);
  write(`Ollama host: ${config.ollama.host}`);
  write(`Vector store: ${config.storage.vectorStorePath}`);
  write(`Session store: ${config.storage.sessionStorePath}`);
  write(`Telegram enabled: ${config.gateways.telegram.enabled ? 'yes' : 'no'}`);
  write(`WhatsApp enabled: ${config.gateways.whatsapp.enabled ? 'yes' : 'no'}`);
  write(`Dashboard enabled: ${config.dashboard.enabled ? `yes (${config.dashboard.port})` : 'no'}`);
  write(`launchd plist: ${existsSync(getLaunchdPlistPath()) ? 'installed' : 'not installed'}`);

  try {
    const warnings = await validateStartup(config);
    if (warnings.length === 0) {
      write('Startup checks: OK');
    } else {
      write('Startup checks: OK with warnings');
      for (const warning of warnings) {
        write(`Warning: ${warning}`);
      }
      write('Recovery hints:');
      write('- If Ollama is unavailable, start it and verify OLLAMA_HOST');
      write('- If Telegram is enabled, confirm TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
      write('- If storage paths fail, inspect permissions on data/ and configured paths');
    }

    return 0;
  } catch (error: any) {
    write(`Startup checks: FAILED`);
    write(`Error: ${error.message}`);
    write('Recovery hints:');
    write('- Run openmac onboard to create missing local config files');
    write('- Review .env and openmac.json values');
    write('- Confirm macOS privacy permissions and local Ollama availability');
    return 1;
  }
}
