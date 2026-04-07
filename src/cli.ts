import { runDoctor } from './doctor';
import { runOpenMac } from './index';

export function resolveCliCommand(argv: string[]) {
  const [command, ...rest] = argv;

  if (command === 'doctor') {
    return { command: 'doctor' as const, argv: rest };
  }

  return { command: 'run' as const, argv: command ? [command, ...rest] : rest };
}

async function main() {
  const resolved = resolveCliCommand(process.argv.slice(2));

  if (resolved.command === 'doctor') {
    const exitCode = await runDoctor();
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
