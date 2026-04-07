import { PermissionClass, TaskSource, Tool, ToolCategory, ToolManifest, ToolRiskLevel } from '../types';

const MANIFESTS: Record<string, ToolManifest> = {
  fs_ls: { category: 'filesystem', riskLevel: 'low', permissionClass: 'read' },
  fs_cat: { category: 'filesystem', riskLevel: 'low', permissionClass: 'read' },
  read_text_file: { category: 'filesystem', riskLevel: 'low', permissionClass: 'read' },
  read_pdf_content: { category: 'filesystem', riskLevel: 'low', permissionClass: 'read' },
  analyze_image_content: { category: 'filesystem', riskLevel: 'low', permissionClass: 'read' },
  browser_chrome_active_tab: { category: 'browser', riskLevel: 'low', permissionClass: 'read' },
  browser_safari_active_tab: { category: 'browser', riskLevel: 'low', permissionClass: 'read' },
  search_vector_memory: { category: 'memory', riskLevel: 'low', permissionClass: 'read' },
  recall_facts: { category: 'memory', riskLevel: 'low', permissionClass: 'read' },
  save_fact: { category: 'memory', riskLevel: 'medium', permissionClass: 'write' },
  get_today_schedule: { category: 'calendar', riskLevel: 'low', permissionClass: 'read' },
  calendar_list_names: { category: 'calendar', riskLevel: 'low', permissionClass: 'read' },
  calendar_list_events: { category: 'calendar', riskLevel: 'low', permissionClass: 'read' },
  calendar_search_events: { category: 'calendar', riskLevel: 'low', permissionClass: 'read' },
  calendar_create_event: { category: 'calendar', riskLevel: 'medium', permissionClass: 'write' },
  calendar_update_event: { category: 'calendar', riskLevel: 'medium', permissionClass: 'write' },
  calendar_delete_event: { category: 'calendar', riskLevel: 'high', permissionClass: 'destructive' },
  reminders_list_items: { category: 'utility', riskLevel: 'low', permissionClass: 'read' },
  reminders_list_names: { category: 'utility', riskLevel: 'low', permissionClass: 'read' },
  reminders_create_item: { category: 'utility', riskLevel: 'medium', permissionClass: 'write' },
  reminders_complete_item: { category: 'utility', riskLevel: 'medium', permissionClass: 'write' },
  reminders_delete_item: { category: 'utility', riskLevel: 'medium', permissionClass: 'write' },
  get_current_time: { category: 'utility', riskLevel: 'low', permissionClass: 'read' },
  get_current_weather: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  fetch_url: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  fetch_url_via_curl: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  fetch_url_via_jina: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  search_arxiv: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  search_wikipedia: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  search_wolframalpha: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  web_search: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  web_search_perplexity: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  web_search_tavily: { category: 'web', riskLevel: 'low', permissionClass: 'read' },
  fs_write: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_patch: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_mkdir: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_cp: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_mv: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_organize: { category: 'filesystem', riskLevel: 'medium', permissionClass: 'write' },
  fs_rm: { category: 'filesystem', riskLevel: 'high', permissionClass: 'destructive' },
  send_system_notification: { category: 'system', riskLevel: 'medium', permissionClass: 'automation' },
  execute_applescript: { category: 'automation', riskLevel: 'medium', permissionClass: 'automation', allowedSources: ['terminal', 'telegram', 'scheduler', 'file_watcher'] },
  play_spotify_track: { category: 'automation', riskLevel: 'medium', permissionClass: 'automation' },
  play_spotify_search: { category: 'automation', riskLevel: 'medium', permissionClass: 'automation' },
  set_system_volume: { category: 'system', riskLevel: 'medium', permissionClass: 'automation' },
  toggle_dark_mode: { category: 'system', riskLevel: 'medium', permissionClass: 'automation' },
  hide_all_apps: { category: 'system', riskLevel: 'medium', permissionClass: 'automation' },
  open_app: { category: 'automation', riskLevel: 'medium', permissionClass: 'automation' },
  take_screenshot: { category: 'system', riskLevel: 'medium', permissionClass: 'automation' },
  empty_trash: { category: 'system', riskLevel: 'high', permissionClass: 'destructive' },
};

export function defaultToolManifest(category: ToolCategory, riskLevel: ToolRiskLevel, permissionClass: PermissionClass): ToolManifest {
  return { category, riskLevel, permissionClass };
}

export function getToolManifest(tool: Pick<Tool, 'name' | 'manifest'>, category: ToolCategory, riskLevel: ToolRiskLevel, permissionClass: PermissionClass): ToolManifest {
  return tool.manifest ?? MANIFESTS[tool.name] ?? defaultToolManifest(category, riskLevel, permissionClass);
}

export function isSourceAllowed(manifest: ToolManifest, source: TaskSource): boolean {
  return !manifest.allowedSources || manifest.allowedSources.includes(source);
}
