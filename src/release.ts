import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const RELEASES_DIR = 'releases'

/** Vendored native bridge package (esbuild external); not bundled into cli.bundle.js. */
const MACOS_NODE_DIR = path.join('nodes', 'macos')
/** npm `file:` specifier must use forward slashes. */
const MACOS_NODE_FILE_SPEC = 'file:./nodes/macos'

/** Canonical CLI entry for dev (`bin/run.sh`) and release (`bin/apex`) — must match `build.mjs` outfile. */
export const RELEASE_CLI_BUNDLE = 'dist/cli.bundle.js'

/** Ensures release tarball launcher still targets the bundled CLI (guards drift vs unbundled dist/cli.js). */
export function assertReleaseLauncherUsesBundle(launcherText: string): void {
  if (!launcherText.includes(RELEASE_CLI_BUNDLE)) {
    throw new Error(`Release verification: bin/apex must invoke ${RELEASE_CLI_BUNDLE} (got launcher drift).`)
  }
}

const REQUIRED_RELEASE_FILES = [
  RELEASE_CLI_BUNDLE,
  'dist/index.js',
  'bin/apex',
  'README.md',
  '.env.example',
  'apex.json.example',
  'package.json',
  'package-lock.json',
  'node_modules',
]

/** Vendored native package (file:./nodes/macos); must exist after pack for tarball consumers. */
const REQUIRED_STAGING_PATHS = [
  path.join('nodes', 'macos', 'package.json'),
  path.join('nodes', 'macos', 'dist', 'index.js'),
]

function copyRecursive(source: string, target: string): void {
  const stats = fs.statSync(source)
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry))
    }
    return
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function writeReleaseLauncher(targetPath: string): void {
  // Same entry as repo `bin/run.sh`: bundled CLI for consistent startup (not unbundled dist/cli.js).
  const content = `#!/bin/bash
DIR="$( cd "$( dirname "$0" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"
exec node "${RELEASE_CLI_BUNDLE}" "$@"
`
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, content, 'utf8')
  fs.chmodSync(targetPath, 0o755)
}

/**
 * Production dependencies for the release tarball: npm registry semver only.
 * Workspace packages are compiled into dist/ or supplied via file: (see @apex/macos-node).
 */
export function buildReleaseFlattenedDependencies(root: string): Record<string, string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, any>
  const raw = (pkg.dependencies ?? {}) as Record<string, string>
  const out: Record<string, string> = {}
  for (const [name, spec] of Object.entries(raw)) {
    if (String(spec).startsWith('workspace:')) continue
    out[name] = String(spec)
  }
  return out
}

/**
 * Flattened manifest for release staging. Must be compatible with npm install / npm ci (no workspace: protocol).
 */
export function buildReleasePackageJson(root: string): Record<string, unknown> {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, any>
  const dependencies = {
    ...buildReleaseFlattenedDependencies(root),
    '@apex/macos-node': MACOS_NODE_FILE_SPEC,
  }
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: 'dist/index.js',
    bin: {
      apex: './bin/apex',
    },
    dependencies,
  }
}

function shouldSkipMacosCopy(src: string): boolean {
  const n = src.replace(/\\/g, '/')
  return n.includes('/node_modules/')
}

/**
 * Copy nodes/macos into staging for file:./nodes/macos (esbuild external; not in the JS bundle).
 */
function copyMacosNodeIntoStaging(root: string, stagingDir: string): void {
  const src = path.join(root, MACOS_NODE_DIR)
  if (!fs.existsSync(src)) {
    throw new Error(`Release pack: missing ${MACOS_NODE_DIR} (required for @apex/macos-node).`)
  }
  const dst = path.join(stagingDir, MACOS_NODE_DIR)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => !shouldSkipMacosCopy(s),
  })
}

/**
 * Staging install cannot resolve workspace:*. macos-node lists @apex/types as workspace — types are compile-time;
 * runtime dist/ does not require that package.
 */
function stripWorkspaceDepsFromStagingMacosPackageJson(stagingDir: string): void {
  const p = path.join(stagingDir, MACOS_NODE_DIR, 'package.json')
  if (!fs.existsSync(p)) return
  const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
  const next = { ...j, dependencies: {} }
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function assertPackageJsonNoWorkspaceDeps(filePath: string): void {
  const j = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { dependencies?: Record<string, string> }
  for (const [name, spec] of Object.entries(j.dependencies ?? {})) {
    if (String(spec).startsWith('workspace:')) {
      throw new Error(
        `Release verification: ${filePath} dependency ${name} uses workspace: (${spec}) — npm tarball install cannot resolve it.`,
      )
    }
  }
}

function assertStagingFreeOfWorkspaceProtocols(stagingDir: string): void {
  assertPackageJsonNoWorkspaceDeps(path.join(stagingDir, 'package.json'))
  const macosPkg = path.join(stagingDir, MACOS_NODE_DIR, 'package.json')
  if (fs.existsSync(macosPkg)) assertPackageJsonNoWorkspaceDeps(macosPkg)
}

function assertReleaseLockfileReferencesMacosFileSpec(stagingDir: string): void {
  const lockPath = path.join(stagingDir, 'package-lock.json')
  const text = fs.readFileSync(lockPath, 'utf8')
  if (!/nodes[/\\]macos/.test(text)) {
    throw new Error(
      'Release verification: package-lock.json should reference the vendored nodes/macos path (file: install).',
    )
  }
}

/**
 * Ensures npm linked/copied file:./nodes/macos into node_modules (staging install is real).
 * Uses `require.resolve` only — avoids loading the native addon in this check (can block or be slow).
 */
function assertMacosNodeModuleResolvableFromStaging(stagingDir: string): void {
  execFileSync(
    'node',
    [
      '-e',
      "const p=require.resolve('@apex/macos-node'); if(!String(p).includes('nodes')||!String(p).includes('macos')){throw new Error('Release verification: @apex/macos-node must resolve under vendored nodes/macos, got: '+p)}",
    ],
    {
      cwd: stagingDir,
      stdio: 'inherit',
      env: process.env,
    },
  )
}

export async function runReleasePack(write: (line: string) => void = console.log): Promise<number> {
  const root = process.cwd()
  const distPath = path.join(root, 'dist')
  if (!fs.existsSync(distPath)) {
    throw new Error('Build output missing. Run `npm run build` (tsc + build.mjs) before packaging a release.')
  }
  const bundlePath = path.join(distPath, 'cli.bundle.js')
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Missing ${RELEASE_CLI_BUNDLE}. Run "npm run build" so esbuild produces the CLI bundle.`)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const version = pkg.version
  const releaseName = `apex-${version}`
  const releasesDir = path.join(root, RELEASES_DIR)
  const stagingDir = path.join(releasesDir, releaseName)
  const archivePath = path.join(releasesDir, `${releaseName}.tar.gz`)

  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.rmSync(archivePath, { force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  copyRecursive(distPath, path.join(stagingDir, 'dist'))
  copyRecursive(path.join(root, '.env.example'), path.join(stagingDir, '.env.example'))
  copyRecursive(path.join(root, 'apex.json.example'), path.join(stagingDir, 'apex.json.example'))
  copyRecursive(path.join(root, 'README.md'), path.join(stagingDir, 'README.md'))

  copyMacosNodeIntoStaging(root, stagingDir)
  stripWorkspaceDepsFromStagingMacosPackageJson(stagingDir)

  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify(buildReleasePackageJson(root), null, 2),
    'utf8',
  )
  writeReleaseLauncher(path.join(stagingDir, 'bin', 'apex'))

  const npmEnv = {
    ...process.env,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
  }

  write(
    'Installing production dependencies into release staging (npm install → npm ci; lockfile generated in staging)...',
  )
  execFileSync('npm', ['install', '--omit=dev'], {
    cwd: stagingDir,
    stdio: 'inherit',
    env: npmEnv,
  })
  const nm = path.join(stagingDir, 'node_modules')
  if (fs.existsSync(nm)) fs.rmSync(nm, { recursive: true, force: true })
  execFileSync('npm', ['ci', '--omit=dev'], {
    cwd: stagingDir,
    stdio: 'inherit',
    env: npmEnv,
  })

  execFileSync('tar', ['-czf', archivePath, '-C', releasesDir, releaseName])

  write(`Release staging directory: ${stagingDir}`)
  write(`Release archive: ${archivePath}`)
  write('Install flow: tar -xzf <archive> && cd apex-<version> && ./bin/apex update')
  write(`Note: release CLI entry is ${RELEASE_CLI_BUNDLE} (same family as dev bin/run.sh).`)
  return 0
}

export async function runReleaseVerify(write: (line: string) => void = console.log): Promise<number> {
  const root = process.cwd()
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const releaseName = `apex-${pkg.version}`
  const stagingDir = path.join(root, RELEASES_DIR, releaseName)
  const archivePath = path.join(root, RELEASES_DIR, `${releaseName}.tar.gz`)

  if (!fs.existsSync(stagingDir)) {
    throw new Error(`Release staging directory missing: ${stagingDir}. Run npm run release:pack first.`)
  }

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Release archive missing: ${archivePath}. Run npm run release:pack first.`)
  }

  assertStagingFreeOfWorkspaceProtocols(stagingDir)

  for (const relativePath of REQUIRED_RELEASE_FILES) {
    const fullPath = path.join(stagingDir, relativePath)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Release verification failed. Missing ${relativePath} in ${stagingDir}`)
    }
  }

  for (const rel of REQUIRED_STAGING_PATHS) {
    const fullPath = path.join(stagingDir, rel)
    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `Release verification failed. Missing vendored native path ${rel} — run a full build (workspace compiles nodes/macos) before release:pack.`,
      )
    }
  }

  assertReleaseLockfileReferencesMacosFileSpec(stagingDir)
  assertMacosNodeModuleResolvableFromStaging(stagingDir)

  const launcherPath = path.join(stagingDir, 'bin', 'apex')
  assertReleaseLauncherUsesBundle(fs.readFileSync(launcherPath, 'utf8'))

  const archiveStats = fs.statSync(archivePath)
  if (archiveStats.size === 0) {
    throw new Error(`Release verification failed. Archive is empty: ${archivePath}`)
  }

  const verifyCliEnv = {
    ...process.env,
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
  }
  execFileSync('node', [RELEASE_CLI_BUNDLE, 'update'], {
    cwd: stagingDir,
    stdio: 'ignore',
    env: verifyCliEnv,
  })

  write(`Release verification passed for ${releaseName}`)
  write(`Verified archive: ${archivePath}`)
  return 0
}
