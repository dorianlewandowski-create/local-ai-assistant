import { PluginManifest } from './types';

export function registerPlugins(manifests: PluginManifest[]): void {
  for (const manifest of manifests) {
    manifest.register();
  }
}
