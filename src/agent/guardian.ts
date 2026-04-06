import path from 'path';

const DANGEROUS_KEYWORDS = ['rm', 'rf', 'mv', 'sudo', 'chmod', 'delete', 'unlink'];
const PROTECTED_PATHS = ['/', '/System', '/Users/Shared'];
const MUTATING_TOOLS = new Set(['fs_rm', 'fs_mv', 'fs_write', 'fs_patch', 'fs_mkdir', 'fs_cp', 'fs_organize', 'calendar_create_event', 'calendar_delete_event']);
const APPLESCRIPT_TOOLS = new Set(['execute_applescript', 'play_spotify_track', 'set_system_volume', 'toggle_dark_mode', 'hide_all_apps', 'open_app', 'empty_trash']);

export interface GuardianDecision {
  requiresAuthorization: boolean;
  command: string;
  reason: string;
}

function buildAppleScriptPreview(toolName: string, args: any): string | null {
  switch (toolName) {
    case 'execute_applescript':
      return typeof args?.script === 'string' ? args.script : null;
    case 'play_spotify_track':
      return typeof args?.name === 'string'
        ? `tell application "Spotify"\nactivate\nplay track ${JSON.stringify(args.name)}\nend tell`
        : null;
    case 'set_system_volume':
      return typeof args?.level === 'number' ? `set volume output volume ${args.level}` : null;
    case 'toggle_dark_mode':
      return 'tell application "System Events"\ntell appearance preferences\nset dark mode to not dark mode\nend tell\nend tell';
    case 'hide_all_apps':
      return 'tell application "System Events" to key code 103 using {command down}';
    case 'open_app':
      return typeof args?.appName === 'string' ? `tell application ${JSON.stringify(args.appName)} to activate` : null;
    case 'empty_trash':
      return 'tell application "Finder"\nempty the trash\nend tell';
    default:
      return null;
  }
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
  const appleScriptPreview = buildAppleScriptPreview(toolName, args);

  if (APPLESCRIPT_TOOLS.has(toolName)) {
    return {
      requiresAuthorization: true,
      command: appleScriptPreview || `${toolName} ${serialized}`,
      reason: 'AppleScript can directly control macOS applications and system behavior.',
    };
  }

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
