/**
 * Load `.env` from the repository root (parent of `dist/`) so keys resolve when
 * running `node dist/cli.js` from any working directory.
 *
 * Must stay free of `@apex/core` imports so it can run before config loads.
 */
import path from 'node:path'
import dotenv from 'dotenv'

/** Parent of `dist/` when this file is emitted as `dist/loadEnv.js`. */
export function getProjectRootFromEntry(): string {
  return path.resolve(__dirname, '..')
}

export function loadEnvFromProjectRoot(): void {
  const envPath = path.join(getProjectRootFromEntry(), '.env')
  dotenv.config({ path: envPath })
}

loadEnvFromProjectRoot()
