import { config } from './config';
import { validateStartup } from './startupValidation';

export async function runDoctor(write: (line: string) => void = console.log): Promise<number> {
  write('OpenMac Doctor');
  write(`Config file: ${config.meta.configPath ?? 'none'}`);
  write(`Ollama host: ${config.ollama.host}`);
  write(`Vector store: ${config.storage.vectorStorePath}`);
  write(`Telegram enabled: ${config.gateways.telegram.enabled ? 'yes' : 'no'}`);
  write(`WhatsApp enabled: ${config.gateways.whatsapp.enabled ? 'yes' : 'no'}`);

  try {
    const warnings = await validateStartup(config);
    if (warnings.length === 0) {
      write('Startup checks: OK');
    } else {
      write('Startup checks: OK with warnings');
      for (const warning of warnings) {
        write(`Warning: ${warning}`);
      }
    }

    return 0;
  } catch (error: any) {
    write(`Startup checks: FAILED`);
    write(`Error: ${error.message}`);
    return 1;
  }
}
