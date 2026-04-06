import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

async function runAppleScript(script: string) {
  logger.system('⌨️ Executing System Command...');
  const command = `osascript -e ${JSON.stringify(script)}`;
  const { stdout, stderr } = await execAsync(command);

  if (stderr) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

function buildPlaySpotifyTrackScript(trackName: string) {
  return `tell application "Spotify"
activate
play track ${JSON.stringify(trackName)}
end tell`;
}

function buildSetSystemVolumeScript(level: number) {
  return `set volume output volume ${level}`;
}

function buildOpenAppScript(appName: string) {
  return `tell application ${JSON.stringify(appName)} to activate`;
}

function buildToggleDarkModeScript() {
  return `tell application "System Events"
tell appearance preferences
set dark mode to not dark mode
end tell
end tell`;
}

function buildHideAllAppsScript() {
  return `tell application "System Events" to key code 103 using {command down}`;
}

function buildEmptyTrashScript() {
  return `tell application "Finder"
empty the trash
end tell`;
}

const ExecuteAppleScriptParams = z.object({
  script: z.string().min(1).describe('Raw AppleScript code to run via osascript. This directly controls macOS applications and system behaviors.'),
});

export const executeAppleScript: Tool<typeof ExecuteAppleScriptParams> = {
  name: 'execute_applescript',
  description: 'Execute raw AppleScript on macOS for direct app and system control.',
  parameters: ExecuteAppleScriptParams,
  execute: async ({ script }) => {
    try {
      const result = await runAppleScript(script);
      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const PlaySpotifyTrackParams = z.object({
  name: z.string().min(1).describe('The exact track name to play in Spotify.'),
});

export const playSpotifyTrack: Tool<typeof PlaySpotifyTrackParams> = {
  name: 'play_spotify_track',
  description: 'Open Spotify and play a requested track.',
  parameters: PlaySpotifyTrackParams,
  execute: async ({ name }) => {
    try {
      const script = buildPlaySpotifyTrackScript(name);
      const result = await runAppleScript(script);
      return { success: true, result: result || `Requested Spotify playback for ${name}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const SetSystemVolumeParams = z.object({
  level: z.number().int().min(0).max(100).describe('System output volume level from 0 to 100.'),
});

export const setSystemVolume: Tool<typeof SetSystemVolumeParams> = {
  name: 'set_system_volume',
  description: 'Adjust the macOS system output volume.',
  parameters: SetSystemVolumeParams,
  execute: async ({ level }) => {
    try {
      const script = buildSetSystemVolumeScript(level);
      const result = await runAppleScript(script);
      return { success: true, result: result || `Volume set to ${level}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const ToggleDarkModeParams = z.object({});

export const toggleDarkMode: Tool<typeof ToggleDarkModeParams> = {
  name: 'toggle_dark_mode',
  description: 'Toggle macOS dark mode via System Events.',
  parameters: ToggleDarkModeParams,
  execute: async () => {
    try {
      const result = await runAppleScript(buildToggleDarkModeScript());
      return { success: true, result: result || 'Toggled dark mode.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const HideAllAppsParams = z.object({});

export const hideAllApps: Tool<typeof HideAllAppsParams> = {
  name: 'hide_all_apps',
  description: 'Show the desktop by hiding other apps.',
  parameters: HideAllAppsParams,
  execute: async () => {
    try {
      const result = await runAppleScript(buildHideAllAppsScript());
      return { success: true, result: result || 'Hid all apps.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const OpenAppParams = z.object({
  appName: z.string().min(1).describe('The macOS application name to launch, such as Safari, Notes, or Music.'),
});

export const openApp: Tool<typeof OpenAppParams> = {
  name: 'open_app',
  description: 'Launch or focus a macOS application.',
  parameters: OpenAppParams,
  execute: async ({ appName }) => {
    try {
      const script = buildOpenAppScript(appName);
      const result = await runAppleScript(script);
      return { success: true, result: result || `Opened ${appName}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const EmptyTrashParams = z.object({});

export const emptyTrash: Tool<typeof EmptyTrashParams> = {
  name: 'empty_trash',
  description: 'Empty the macOS Trash using Finder.',
  parameters: EmptyTrashParams,
  execute: async () => {
    try {
      const script = buildEmptyTrashScript();
      const result = await runAppleScript(script);
      return { success: true, result: result || 'Trash emptied.' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(executeAppleScript);
toolRegistry.register(playSpotifyTrack);
toolRegistry.register(setSystemVolume);
toolRegistry.register(toggleDarkMode);
toolRegistry.register(hideAllApps);
toolRegistry.register(openApp);
toolRegistry.register(emptyTrash);

export const appleScriptTemplates = {
  buildPlaySpotifyTrackScript,
  buildSetSystemVolumeScript,
  buildOpenAppScript,
  buildToggleDarkModeScript,
  buildHideAllAppsScript,
  buildEmptyTrashScript,
};
