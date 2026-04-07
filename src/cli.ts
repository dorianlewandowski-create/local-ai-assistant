import { runDoctor } from './doctor';
import { runOpenMac } from './index';
import { runOnboard } from './onboard';
import { installLaunchdPlist } from './launchd';
import { runUpdateHelp } from './update';
import { runReleasePack, runReleaseVerify } from './release';
import { runPairing } from './pairing';
import { createRuntimeServiceClient } from './runtime/serviceClient';

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

  return { command: 'run' as const, argv: command ? [command, ...rest] : rest };
}

async function main() {
  const resolved = resolveCliCommand(process.argv.slice(2));

  if (resolved.command === 'doctor') {
    const exitCode = await runDoctor();
    process.exit(exitCode);
  }

  if (resolved.command === 'onboard') {
    const exitCode = await runOnboard();
    process.exit(exitCode);
  }

  if (resolved.command === 'launchd-install') {
    const exitCode = await installLaunchdPlist();
    process.exit(exitCode);
  }

  if (resolved.command === 'update') {
    const exitCode = await runUpdateHelp();
    process.exit(exitCode);
  }

  if (resolved.command === 'release-pack') {
    const exitCode = await runReleasePack();
    process.exit(exitCode);
  }

  if (resolved.command === 'release-verify') {
    const exitCode = await runReleaseVerify();
    process.exit(exitCode);
  }

  if (resolved.command === 'pairing') {
    const exitCode = await runPairing(resolved.argv);
    process.exit(exitCode);
  }

  if (resolved.command === 'service-status') {
    const client = createRuntimeServiceClient();
    const snapshot = await client.getStatusSnapshot();
    console.log(JSON.stringify(snapshot, null, 2));
    process.exit(0);
  }

  if (resolved.command === 'service-safe') {
    const value = resolved.argv[0]?.toLowerCase();
    if (value !== 'on' && value !== 'off') {
      throw new Error('Usage: openmac service-safe <on|off>');
    }
    const client = createRuntimeServiceClient();
    await client.setRemoteSafeMode(value === 'on');
    console.log(`Remote-safe mode set to ${value}.`);
    process.exit(0);
  }

  if (resolved.command === 'service-model') {
    const [source, sourceId, ...modelParts] = resolved.argv;
    const model = modelParts.join(' ').trim();
    if (!source || !sourceId || !model) {
      throw new Error('Usage: openmac service-model <source> <sourceId> <model>');
    }
    const client = createRuntimeServiceClient();
    await client.setSessionModel(source as any, sourceId, model);
    console.log(`Runtime service model updated for ${source}:${sourceId}.`);
    process.exit(0);
  }

  if (resolved.command === 'service-sandbox') {
    const [source, sourceId, mode] = resolved.argv;
    if (!source || !sourceId || !mode || !['default', 'strict', 'off'].includes(mode)) {
      throw new Error('Usage: openmac service-sandbox <source> <sourceId> <default|strict|off>');
    }
    const client = createRuntimeServiceClient();
    await client.setSessionSandboxMode(source as any, sourceId, mode as 'default' | 'strict' | 'off');
    console.log(`Runtime service sandbox updated for ${source}:${sourceId}.`);
    process.exit(0);
  }

  await runOpenMac(resolved.argv);
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message);
    process.exit(1);
  });
}
