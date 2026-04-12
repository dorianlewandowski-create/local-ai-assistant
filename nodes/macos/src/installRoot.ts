import fs from 'node:fs'
import path from 'node:path'

const BRIDGE_REL = path.join('nodes', 'macos', 'claw-native-bridge')

/**
 * Anchor for walking upward: primary Node entry script (e.g. dist/ when running
 * `node dist/cli.bundle.js`), else cwd. Avoids cwd-only and import.meta assumptions.
 */
function getAnchorDir(): string {
  const argv1 = process.argv[1]
  if (argv1) {
    return path.dirname(path.resolve(argv1))
  }
  return process.cwd()
}

/**
 * Resolve the Apex **installation root** (directory that contains `nodes/macos/...`).
 * Used for native bridge and other repo-relative assets — **not** cwd-dependent.
 *
 * Resolution order:
 * 1. `APEX_INSTALL_ROOT` (absolute path to project / release root)
 * 2. Walk upward from anchor directory until `nodes/macos/claw-native-bridge` exists
 * 3. Walk upward from `process.cwd()` as fallback
 */
export function resolveApexInstallRoot(): string {
  const env = process.env.APEX_INSTALL_ROOT?.trim()
  if (env) {
    return path.resolve(env)
  }

  const fromAnchor = walkToInstallRoot(getAnchorDir())
  if (fromAnchor) {
    return fromAnchor
  }

  const fromCwd = walkToInstallRoot(process.cwd())
  if (fromCwd) {
    return fromCwd
  }

  return process.cwd()
}

function hasBridgeUnder(root: string): boolean {
  return fs.existsSync(path.join(root, BRIDGE_REL))
}

function walkToInstallRoot(startDir: string): string | null {
  let cur = path.resolve(startDir)
  for (let i = 0; i < 14; i++) {
    if (hasBridgeUnder(cur)) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return null
}
