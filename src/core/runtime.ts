import fs from 'fs'
import path from 'path'
import { DEFAULT_CONFIG_FILE_NAME, resolveConfigPath, config } from '@apex/core'

/**
 * Minimal runtime config state for interactive UX.
 * This is intentionally lightweight and CLI-oriented.
 */
export const runtimeConfig: {
  activeModel: string
  modelMode: 'auto' | 'manual'
  lockedModel: string
} = {
  activeModel: config.models.chat,
  modelMode: config.modelMode,
  lockedModel: config.lockedModel,
}

/**
 * Best-effort config persistence helper.
 *
 * Writes to the resolved config path when present, otherwise creates `apex.json`
 * in the current working directory.
 */
export function saveConfigPatch(patch: Record<string, any>): string {
  const cwd = process.cwd()
  const configPath = resolveConfigPath(cwd) ?? path.join(cwd, DEFAULT_CONFIG_FILE_NAME)
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {}
  const merged = { ...existing, ...patch }
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  return configPath
}
