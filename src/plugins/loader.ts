import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExternalPluginManifestFile, PluginManifest } from './types';

const MANIFEST_FILE_NAME = 'openmac-plugin.json';

function isSafePluginId(id: string): boolean {
  return /^[a-z0-9-]+$/i.test(id);
}

function resolvePluginEntry(pluginRoot: string, mainFile: string): string {
  if (!mainFile || path.isAbsolute(mainFile)) {
    throw new Error('Plugin main must be a relative path.');
  }

  const resolved = path.resolve(pluginRoot, mainFile);
  if (!resolved.startsWith(path.resolve(pluginRoot) + path.sep) && resolved !== path.resolve(pluginRoot, mainFile)) {
    throw new Error('Plugin main must stay inside the plugin directory.');
  }

  return resolved;
}

function loadExternalPlugin(pluginRoot: string): PluginManifest {
  const manifestPath = path.join(pluginRoot, MANIFEST_FILE_NAME);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExternalPluginManifestFile;

  if (!manifest.id || !isSafePluginId(manifest.id)) {
    throw new Error(`Invalid plugin id in ${manifestPath}`);
  }

  if (!manifest.description) {
    throw new Error(`Plugin ${manifest.id} is missing description`);
  }

  const entryPath = resolvePluginEntry(pluginRoot, manifest.main);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Plugin entry not found for ${manifest.id}: ${entryPath}`);
  }

  const loaded = require(entryPath);
  const register = loaded?.register || loaded?.default?.register;
  if (typeof register !== 'function') {
    throw new Error(`Plugin ${manifest.id} must export a register() function`);
  }

  return {
    id: manifest.id,
    description: manifest.description,
    register: () => register(),
  };
}

export function discoverExternalPlugins(pluginDirectory = config.plugins.directory): PluginManifest[] {
  if (!config.plugins.enabled || !fs.existsSync(pluginDirectory)) {
    return [];
  }

  const directories = fs.readdirSync(pluginDirectory)
    .map((entry) => path.join(pluginDirectory, entry))
    .filter((entryPath) => fs.existsSync(path.join(entryPath, MANIFEST_FILE_NAME)));

  const plugins: PluginManifest[] = [];
  for (const pluginRoot of directories) {
    try {
      plugins.push(loadExternalPlugin(pluginRoot));
    } catch (error: any) {
      logger.warn(`Skipping plugin ${pluginRoot}: ${error.message}`);
    }
  }

  return plugins;
}

export function registerPlugins(manifests: PluginManifest[]): void {
  for (const manifest of manifests) {
    manifest.register();
  }
}
