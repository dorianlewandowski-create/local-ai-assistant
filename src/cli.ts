import { runDoctor } from './doctor';
import { runOpenMac } from './index';
import { runOnboard } from './onboard';
import { installLaunchdPlist } from './launchd';
import { runUpdateHelp } from './update';
import { runReleasePack } from './release';
import { runPairing } from './pairing';

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

  if (command === 'pairing') {
    return { command: 'pairing' as const, argv: rest };
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

  if (resolved.command === 'pairing') {
    const exitCode = await runPairing(resolved.argv);
    process.exit(exitCode);
  }

  await runOpenMac(resolved.argv);
}

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message);
    process.exit(1);
  });
}
