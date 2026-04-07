import { approvePairingCode, listPendingPairings } from './security/channelPairingStore';

type SupportedChannel = 'slack' | 'whatsapp';

export async function runPairing(args: string[], write: (line: string) => void = console.log): Promise<number> {
  const [action, channel, code] = args;
  if (!action || !channel || (action === 'approve' && !code)) {
    write('Usage: openmac pairing list <slack|whatsapp>');
    write('   or: openmac pairing approve <slack|whatsapp> <CODE>');
    return 1;
  }

  if (channel !== 'slack' && channel !== 'whatsapp') {
    write('Supported pairing channels: slack, whatsapp');
    return 1;
  }

  if (action === 'list') {
    const pending = listPendingPairings(channel as SupportedChannel);
    if (pending.length === 0) {
      write(`No pending ${channel} pairings.`);
      return 0;
    }

    write(`Pending ${channel} pairings:`);
    for (const item of pending) {
      write(`- ${item.code} -> ${item.subject}`);
    }
    return 0;
  }

  if (action === 'approve') {
    const subject = approvePairingCode(channel as SupportedChannel, code!);
    if (!subject) {
      write(`Pairing code ${code} not found for ${channel}.`);
      return 1;
    }

    write(`Approved ${channel} pairing for ${subject}.`);
    return 0;
  }

  write('Supported pairing actions: list, approve');
  return 1;
}
