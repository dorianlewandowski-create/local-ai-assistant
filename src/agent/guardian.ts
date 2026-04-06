import path from 'path';

const DANGEROUS_KEYWORDS = ['rm', 'rf', 'mv', 'sudo', 'chmod', 'delete', 'unlink'];
const PROTECTED_PATHS = ['/', '/System', '/Users/Shared'];
const MUTATING_TOOLS = new Set(['fs_rm', 'fs_mv', 'fs_write', 'fs_patch', 'fs_mkdir', 'fs_cp', 'fs_organize']);

export interface GuardianDecision {
  requiresAuthorization: boolean;
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

export function assessToolRisk(toolName: string, args: unknown): GuardianDecision | null {
  const strings = collectStrings(args);
  const serialized = JSON.stringify(args ?? {});
  const protectedPath = strings.find((value) => looksLikePath(value) && isProtectedPath(value));

  if (protectedPath) {
    return {
      requiresAuthorization: true,
      command: `${toolName} ${serialized}`,
      reason: `Touches protected path: ${protectedPath}`,
    };
  }

  const matchedKeyword = DANGEROUS_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(serialized));
  if (matchedKeyword) {
    return {
      requiresAuthorization: true,
      command: `${toolName} ${serialized}`,
      reason: `Contains dangerous keyword: ${matchedKeyword}`,
    };
  }

  if (MUTATING_TOOLS.has(toolName)) {
    return {
      requiresAuthorization: true,
      command: `${toolName} ${serialized}`,
      reason: 'This tool modifies files or the local system.',
    };
  }

  return null;
}
