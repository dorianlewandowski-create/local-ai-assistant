import { runDoctor } from './doctor';
import { runDaemon } from './runtime/daemon';
import { runOpenMac } from './index';
import { runOnboard } from './onboard';
import { installLaunchdPlist } from './launchd';
import { runUpdateHelp } from './update';
import { runReleasePack, runReleaseVerify } from './release';
import { runPairing } from './pairing';
import { createRuntimeServiceClient } from './runtime/serviceClient';
import { resolveCliCommand } from './index';
import fs from 'fs';
import path from 'path';

function logFatalError(error: any) {
  const logPath = path.join(process.cwd(), 'debug.log');
  const message = `[${new Date().toISOString()}] FATAL ERROR (CLI): ${error.stack || error.message}\n`;
  fs.appendFileSync(logPath, message);
  console.error(message);
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

  if (resolved.command === 'daemon') {
    await runDaemon();
    return;
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

  if (resolved.command === 'service-approvals') {
    const client = createRuntimeServiceClient();
    const approvals = await client.listPendingApprovals();
    console.log(JSON.stringify(approvals, null, 2));
    process.exit(0);
  }

  if (resolved.command === 'service-approve') {
    const [id] = resolved.argv;
    if (!id) {
      throw new Error('Usage: openmac service-approve <id>');
    }
    const client = createRuntimeServiceClient();
    const ok = await client.settleApproval(id, true);
    console.log(ok ? `Approved ${id}.` : `Approval ${id} was not found.`);
    process.exit(ok ? 0 : 1);
  }

  if (resolved.command === 'service-deny') {
    const [id] = resolved.argv;
    if (!id) {
      throw new Error('Usage: openmac service-deny <id>');
    }
    const client = createRuntimeServiceClient();
    const ok = await client.settleApproval(id, false);
    console.log(ok ? `Denied ${id}.` : `Approval ${id} was not found.`);
    process.exit(ok ? 0 : 1);
  }

  if (resolved.command === 'service-sessions') {
    const client = createRuntimeServiceClient();
    const sessions = await client.listSessions();
    console.log(JSON.stringify(sessions, null, 2));
    process.exit(0);
  }

  await runOpenMac(resolved.argv);
}

if (require.main === module) {
  void (async () => {
    try {
      await main();
    } catch (error: any) {
      logFatalError(error);
      process.exit(1);
    }
  })();
}
