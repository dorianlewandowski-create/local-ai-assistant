import { exec, execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { z } from 'zod';
import { Tool } from '../types';
import { toolRegistry } from './registry';
import { logger } from '../utils/logger';
import { config } from '../config';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

async function runAppleScript(script: string) {
  logger.system('⌨️ Executing System Command...');
  const { stdout, stderr } = await execFileAsync('osascript', ['-e', script]);

  if (stderr) {
    throw new Error(stderr.trim());
  }

  return stdout.trim();
}

async function getSpotifyAccessToken() {
  const clientId = config.integrations.spotify.clientId;
  const clientSecret = config.integrations.spotify.clientSecret;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify API is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    throw new Error(`Spotify token request failed with status ${response.status}`);
  }

  const data: any = await response.json();
  if (!data.access_token) {
    throw new Error('Spotify token response did not include an access token.');
  }

  return data.access_token as string;
}

function normalizeSpotifyQuery(query: string) {
  const trimmed = query.trim();
  const anySongMatch = trimmed.match(/any song from\s+(.+)/i);
  if (anySongMatch) {
    return {
      searchQuery: `artist:${anySongMatch[1].trim()}`,
      mode: 'artist',
    };
  }

  const fromArtistMatch = trimmed.match(/(.+)\s+from\s+(.+)/i);
  if (fromArtistMatch) {
    return {
      searchQuery: `track:${fromArtistMatch[1].trim()} artist:${fromArtistMatch[2].trim()}`,
      mode: 'track',
    };
  }

  return {
    searchQuery: trimmed,
    mode: 'track',
  };
}

async function searchSpotifyTrackUri(query: string) {
  const accessToken = await getSpotifyAccessToken();
  const normalized = normalizeSpotifyQuery(query);
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set('q', normalized.searchQuery);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Spotify search failed with status ${response.status}`);
  }

  const data: any = await response.json();
  const track = data.tracks?.items?.[0];
  if (!track?.uri) {
    throw new Error(`No Spotify track found for query: ${query}`);
  }

  return {
    uri: track.uri as string,
    name: track.name as string,
    artist: Array.isArray(track.artists) ? track.artists.map((artist: any) => artist.name).join(', ') : 'Unknown artist',
  };
}

function buildPlaySpotifyTrackScript(trackUri: string) {
  return `tell application "Spotify"
activate
open location ${JSON.stringify(trackUri)}
delay 2
play
delay 1
set playerState to (player state as string)
set trackName to name of current track
set artistName to artist of current track
set trackId to id of current track
return playerState & " | " & trackName & " | " & artistName & " | " & trackId
end tell`;
}

function buildPlaySpotifySearchScript(query: string) {
  return `tell application "Spotify"
activate
open location ${JSON.stringify(`spotify:search:${query}`)}
delay 1
end tell`;
}

function parseSpotifyPlaybackResult(result: string) {
  const parts = result.split(' | ');
  return {
    state: parts[0] || 'stopped',
    track: parts[1] || '',
    artist: parts[2] || '',
    uri: parts[3] || '',
  };
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

async function takeScreenshotFile() {
  const outputPath = path.join(os.tmpdir(), `openmac-screenshot-${Date.now()}.png`);
  const { stderr } = await execFileAsync('screencapture', ['-x', outputPath]);
  if (stderr) {
    throw new Error(stderr.trim());
  }

  return outputPath;
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
  uri: z.string().min(1).describe('The exact Spotify track URI, such as spotify:track:123abc. Use this only when you already know the URI.'),
});

export const playSpotifyTrack: Tool<typeof PlaySpotifyTrackParams> = {
  name: 'play_spotify_track',
  description: 'Open Spotify and play a track by exact Spotify URI.',
  parameters: PlaySpotifyTrackParams,
  execute: async ({ uri }) => {
    try {
      const script = buildPlaySpotifyTrackScript(uri);
      const result = await runAppleScript(script);
      const playback = parseSpotifyPlaybackResult(result);
      const matched = playback.uri === uri;
      if (playback.state !== 'playing' || !matched) {
        return {
          success: false,
          error: `Spotify did not confirm playback for ${uri}. Current state: ${playback.state || 'unknown'}, current track: ${playback.track || 'unknown'}.`,
        };
      }

      return {
        success: true,
        result: `Playing ${playback.track} by ${playback.artist}.`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

const PlaySpotifySearchParams = z.object({
  query: z.string().min(1).describe('A plain-language Spotify search query, such as an artist name, album name, or track request like "labrinth" or "any song from Labrinth".'),
});

export const playSpotifySearch: Tool<typeof PlaySpotifySearchParams> = {
  name: 'play_spotify_search',
  description: 'Resolve a plain-language Spotify request into an exact track URI using the Spotify Web API, then play it in Spotify.',
  parameters: PlaySpotifySearchParams,
  execute: async ({ query }) => {
    try {
      const match = await searchSpotifyTrackUri(query);
      const script = buildPlaySpotifyTrackScript(match.uri);
      const result = await runAppleScript(script);
      const playback = parseSpotifyPlaybackResult(result);
      const matched = playback.uri === match.uri;
      if (playback.state !== 'playing' || !matched) {
        throw new Error(`Spotify search resolved ${match.name}, but playback was not confirmed.`);
      }

      return {
        success: true,
        played: true,
        result: `Playing ${playback.track} by ${playback.artist}.`,
      };
    } catch (error: any) {
      try {
        const fallbackScript = buildPlaySpotifySearchScript(query);
        await runAppleScript(fallbackScript);
        return {
          success: false,
          error: `Opened Spotify search for "${query}", but playback was not confirmed automatically. Do not claim that music is playing.`,
        };
      } catch {
        return { success: false, error: error.message };
      }
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

const TakeScreenshotParams = z.object({});

export const takeScreenshot: Tool<typeof TakeScreenshotParams> = {
  name: 'take_screenshot',
  description: 'Take a macOS screenshot and return the saved file path.',
  parameters: TakeScreenshotParams,
  execute: async () => {
    try {
      const screenshotPath = await takeScreenshotFile();
      return { success: true, result: `Screenshot saved to ${screenshotPath}`, path: screenshotPath };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

toolRegistry.register(executeAppleScript);
toolRegistry.register(playSpotifyTrack);
toolRegistry.register(playSpotifySearch);
toolRegistry.register(setSystemVolume);
toolRegistry.register(toggleDarkMode);
toolRegistry.register(hideAllApps);
toolRegistry.register(openApp);
toolRegistry.register(emptyTrash);
toolRegistry.register(takeScreenshot);

export const appleScriptTemplates = {
  buildPlaySpotifyTrackScript,
  buildPlaySpotifySearchScript,
  buildSetSystemVolumeScript,
  buildOpenAppScript,
  buildToggleDarkModeScript,
  buildHideAllAppsScript,
  buildEmptyTrashScript,
};
