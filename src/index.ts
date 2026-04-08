import 'dotenv/config';
import { registerCoreTools } from './core/registerTools';
import { runOpenMac } from './core/openmacApp';
import { logger } from './utils/logger';
import fs from 'fs';
import path from 'path';

function logFatalError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log');
  const message = `[${new Date().toISOString()}] FATAL ERROR: ${error.stack || error.message}\n`;
  fs.appendFileSync(logPath, message);
  console.error(message);
}

process.on('uncaughtException', (error) => {
  logFatalError(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logFatalError(reason instanceof Error ? reason : new Error(String(reason)));
  // Instead of exit, we can just log it since we've added more try-catches
  // but for reliability let's keep the exit for now to know it's happening.
  process.exit(1);
});

registerCoreTools();

export function resolveCliCommand(argv: string[]) {
  const [command, ...rest] = argv;

  if (command === 'doctor') {
    return { command: 'doctor' as const, argv: rest };
  }

  if (command === 'onboard') {
    return { command: 'onboard' as const, argv: rest };
  }

  if (command === 'launchd-install') {
    return { command: 'launchd-install' as const, argv: rest };
  }

  if (command === 'daemon') {
    return { command: 'daemon' as const, argv: rest };
  }

  if (command === 'update') {
    return { command: 'update' as const, argv: rest };
  }

  if (command === 'release-pack') {
    return { command: 'release-pack' as const, argv: rest };
  }

  if (command === 'release-verify') {
    return { command: 'release-verify' as const, argv: rest };
  }

  if (command === 'pairing') {
    return { command: 'pairing' as const, argv: rest };
  }

  if (command === 'service-status') {
    return { command: 'service-status' as const, argv: rest };
  }

  if (command === 'service-safe') {
    return { command: 'service-safe' as const, argv: rest };
  }

  if (command === 'service-model') {
    return { command: 'service-model' as const, argv: rest };
  }

  if (command === 'service-sandbox') {
    return { command: 'service-sandbox' as const, argv: rest };
  }

  if (command === 'service-approvals') {
    return { command: 'service-approvals' as const, argv: rest };
  }

  if (command === 'service-approve') {
    return { command: 'service-approve' as const, argv: rest };
  }

  if (command === 'service-deny') {
    return { command: 'service-deny' as const, argv: rest };
  }

  if (command === 'service-sessions') {
    return { command: 'service-sessions' as const, argv: rest };
  }

  return { command: 'run' as const, argv: command ? [command, ...rest] : rest };
}

export { runOpenMac };

if (require.main === module) {
  void (async () => {
    try {
      await runOpenMac();
    } catch (error: any) {
      logFatalError(error);
      process.exit(1);
    }
  })();
}
