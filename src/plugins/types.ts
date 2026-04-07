export interface PluginManifest {
  id: string;
  description: string;
  register(): void;
}

export interface ExternalPluginManifestFile {
  id: string;
  description: string;
  main: string;
}
