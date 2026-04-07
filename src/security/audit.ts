import fs from 'fs';
import path from 'path';

const AUDIT_LOG_PATH = path.join(process.cwd(), 'data', 'security-audit.jsonl');

export interface SecurityAuditEvent {
  timestamp: string;
  type: 'authorization_requested' | 'authorization_approved' | 'authorization_denied' | 'authorization_expired' | 'pairing_requested' | 'pairing_approved' | 'pairing_denied' | 'policy_blocked';
  source: string;
  actor?: string;
  toolName?: string;
  permissionClass?: string;
  detail: string;
}

export function getSecurityAuditPath(): string {
  return AUDIT_LOG_PATH;
}

export function writeSecurityAudit(event: SecurityAuditEvent): void {
  fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  fs.appendFileSync(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

export function readRecentSecurityAudit(limit = 25): SecurityAuditEvent[] {
  try {
    const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as SecurityAuditEvent)
      .reverse();
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}
