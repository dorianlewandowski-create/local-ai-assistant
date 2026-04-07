export interface PluginManifest {
  id: string;
  description: string;
  register(): void;
}
