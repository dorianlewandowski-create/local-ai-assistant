import path from 'path';
import { TaskSource, Tool } from '../types';
import { config } from '../config';
import { runtimeSecurityState } from './runtimeState';
import { isSourceAllowed } from './toolManifest';
import { SessionSettings } from '../runtime/sessionStore';

const DANGEROUS_KEYWORDS = ['rm', 'rf', 'sudo', 'chmod', 'delete', 'unlink', 'empty trash'];
const PROTECTED_PATHS = ['/', '/System', '/Users/Shared'];

export interface GuardianDecision {
  allowed: boolean;
  requiresAuthorization: boolean;
  permissionClass: 'read' | 'write' | 'automation' | 'destructive';
  command: string;
  reason: string;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }

  return [];
}

function looksLikePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.includes('/');
}

function isProtectedPath(value: string): boolean {
  const resolved = path.resolve(value);
  return PROTECTED_PATHS.some((protectedPath) => resolved === protectedPath || resolved.startsWith(`${protectedPath}/`));
}

function isRemoteSource(source: TaskSource): boolean {
  return source === 'telegram' || source === 'slack' || source === 'whatsapp';
}

function isChannelToolAllowed(toolName: string, source: TaskSource): boolean {
  if (source !== 'telegram' && source !== 'slack' && source !== 'whatsapp') {
    return true;
  }

  const allowlist = config.security.channelToolAllowlists[source];
  return !allowlist || allowlist.length === 0 || allowlist.includes(toolName);
}

function isSessionToolAllowed(toolName: string, sessionSettings?: SessionSettings): boolean {
  if (!sessionSettings) {
    return true;
  }

  if (sessionSettings.blockedTools?.includes(toolName)) {
    return false;
  }

  if (sessionSettings.allowedTools && sessionSettings.allowedTools.length > 0) {
    return sessionSettings.allowedTools.includes(toolName);
  }

  return true;
}

export function assessToolRisk(tool: Tool, args: unknown, source: TaskSource, sessionSettings?: SessionSettings): GuardianDecision {
  const serialized = JSON.stringify(args ?? {});
  const strings = collectStrings(args);
  let permissionClass = tool.manifest?.permissionClass ?? 'read';
  let reason = permissionClass === 'read' ? 'Read-only tool.' : 'Tool affects local state and requires review.';

  if (!tool.manifest || !isSourceAllowed(tool.manifest, source)) {
    return {
      allowed: false,
      requiresAuthorization: false,
      permissionClass,
      command: `${tool.name} ${serialized}`,
      reason: `${tool.name} is not allowed from ${source}.`,
    };
  }

  if (!isChannelToolAllowed(tool.name, source)) {
    return {
      allowed: false,
      requiresAuthorization: false,
      permissionClass,
      command: `${tool.name} ${serialized}`,
      reason: `${tool.name} is not in the ${source} tool allowlist.`,
    };
  }

  if (!isSessionToolAllowed(tool.name, sessionSettings)) {
    return {
      allowed: false,
      requiresAuthorization: false,
      permissionClass,
      command: `${tool.name} ${serialized}`,
      reason: `${tool.name} is blocked by current session policy.`,
    };
  }

  const protectedPath = strings.find((value) => looksLikePath(value) && isProtectedPath(value));
  if (protectedPath) {
    permissionClass = 'destructive';
    reason = `Touches protected path: ${protectedPath}`;
  } else {
    const matchedKeyword = DANGEROUS_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(serialized));
    if (matchedKeyword) {
      permissionClass = 'destructive';
      reason = `Contains dangerous keyword: ${matchedKeyword}`;
    }
  }

  const requiresAuthorization = permissionClass !== 'read';
  const remoteSafeAllowed = config.security.remoteAllowedPermissions.includes(permissionClass);
  if (isRemoteSource(source) && runtimeSecurityState.isRemoteSafeModeEnabled() && !remoteSafeAllowed) {
    return {
      allowed: false,
      requiresAuthorization: false,
      permissionClass,
      command: `${tool.name} ${serialized}`,
      reason: `Remote-safe mode blocks ${permissionClass} tools from ${source}.`,
    };
  }

  return {
    allowed: true,
    requiresAuthorization,
    permissionClass,
    command: `${tool.name} ${serialized}`,
    reason,
  };
}
