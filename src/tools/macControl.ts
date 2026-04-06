import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';

const execAsync = promisify(exec);

async function runAppleScript(script: string) {
  const command = `osascript -e ${JSON.stringify(script)}`;
  const { stdout, stderr } = await execAsync(command);

  if (stderr) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

function buildPlayMusicScript(trackName: string) {
  return `tell application "Music"
activate
play track ${JSON.stringify(trackName)}
end tell`;
}

function buildSetVolumeScript(level: number) {
  return `set volume output volume ${level}`;
}

function buildOpenAppScript(appName: string) {
  return `tell application ${JSON.stringify(appName)} to activate`;
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

const PlayMusicParams = z.object({
  trackName: z.string().min(1).describe('The exact song name to play in the Music app.'),
});

export const playMusic: Tool<typeof PlayMusicParams> = {
  name: 'play_music',
  description: 'Open the Music app and play a requested track.',
  parameters: PlayMusicParams,
  execute: async ({ trackName }) => {
    try {
      const script = buildPlayMusicScript(trackName);
      const result = await runAppleScript(script);
      return { success: true, result: result || `Requested playback for ${trackName}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const SetVolumeParams = z.object({
  level: z.number().int().min(0).max(100).describe('System output volume level from 0 to 100.'),
});

export const setVolume: Tool<typeof SetVolumeParams> = {
  name: 'set_volume',
  description: 'Adjust the macOS system output volume.',
  parameters: SetVolumeParams,
  execute: async ({ level }) => {
    try {
      const script = buildSetVolumeScript(level);
      const result = await runAppleScript(script);
      return { success: true, result: result || `Volume set to ${level}` };
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
toolRegistry.register(playMusic);
toolRegistry.register(setVolume);
toolRegistry.register(openApp);
toolRegistry.register(emptyTrash);

export const appleScriptTemplates = {
  buildPlayMusicScript,
  buildSetVolumeScript,
  buildOpenAppScript,
  buildEmptyTrashScript,
};
