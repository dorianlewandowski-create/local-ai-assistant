import path from 'path';
import { PermissionClass, TaskSource } from '../types';
import { config } from '../config';
import { runtimeSecurityState } from './runtimeState';

const DANGEROUS_KEYWORDS = ['rm', 'rf', 'sudo', 'chmod', 'delete', 'unlink', 'empty trash'];
const PROTECTED_PATHS = ['/', '/System', '/Users/Shared'];
const TOOL_PERMISSIONS: Record<string, PermissionClass> = {
  fs_ls: 'read',
  fs_cat: 'read',
  read_text_file: 'read',
  read_pdf_content: 'read',
  analyze_image_content: 'read',
  browser_chrome_active_tab: 'read',
  browser_safari_active_tab: 'read',
  search_vector_memory: 'read',
  recall_facts: 'read',
  get_today_schedule: 'read',
  calendar_list_names: 'read',
  calendar_list_events: 'read',
  calendar_search_events: 'read',
  reminders_list_items: 'read',
  reminders_list_names: 'read',
  get_current_time: 'read',
  get_current_weather: 'read',
  fetch_url: 'read',
  fetch_url_via_curl: 'read',
  fetch_url_via_jina: 'read',
  search_arxiv: 'read',
  search_wikipedia: 'read',
  search_wolframalpha: 'read',
  web_search: 'read',
  web_search_perplexity: 'read',
  web_search_tavily: 'read',
  save_fact: 'write',
  fs_write: 'write',
  fs_patch: 'write',
  fs_mkdir: 'write',
  fs_cp: 'write',
  fs_mv: 'write',
  fs_organize: 'write',
  calendar_create_event: 'write',
  calendar_update_event: 'write',
  reminders_create_item: 'write',
  reminders_complete_item: 'write',
  reminders_delete_item: 'write',
  send_system_notification: 'automation',
  execute_applescript: 'automation',
  play_spotify_track: 'automation',
  play_spotify_search: 'automation',
  set_system_volume: 'automation',
  toggle_dark_mode: 'automation',
  hide_all_apps: 'automation',
  open_app: 'automation',
  take_screenshot: 'automation',
  fs_rm: 'destructive',
  calendar_delete_event: 'destructive',
  empty_trash: 'destructive',
};

export interface GuardianDecision {
  allowed: boolean;
  requiresAuthorization: boolean;
  permissionClass: PermissionClass;
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

export function assessToolRisk(toolName: string, args: unknown, source: TaskSource): GuardianDecision {
  const serialized = JSON.stringify(args ?? {});
  const strings = collectStrings(args);
  let permissionClass = TOOL_PERMISSIONS[toolName] ?? 'read';
  let reason = permissionClass === 'read' ? 'Read-only tool.' : 'Tool affects local state and requires review.';

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
      command: `${toolName} ${serialized}`,
      reason: `Remote-safe mode blocks ${permissionClass} tools from ${source}.`,
    };
  }

  return {
    allowed: true,
    requiresAuthorization,
    permissionClass,
    command: `${toolName} ${serialized}`,
    reason,
  };
}
