import fs from 'fs'
import path from 'path'
import { build } from 'esbuild'

const projectRoot = process.cwd()
const srcDir = path.join(projectRoot, 'src')
const distDir = path.join(projectRoot, 'dist')

const WORKSPACE_PACKAGES = [
  { name: '@apex/types', dir: path.join(projectRoot, 'core', 'types') },
  { name: '@apex/memory', dir: path.join(projectRoot, 'core', 'memory') },
  { name: '@apex/core', dir: path.join(projectRoot, 'core', 'brain') },
  { name: '@apex/gateway-shared', dir: path.join(projectRoot, 'gateways', 'shared') },
  { name: '@apex/gateway-screenshot', dir: path.join(projectRoot, 'gateways', 'screenshot') },
  { name: '@apex/gateway-telegram', dir: path.join(projectRoot, 'gateways', 'telegram') },
  { name: '@apex/gateway-whatsapp', dir: path.join(projectRoot, 'gateways', 'whatsapp') },
  { name: '@apex/gateway-slack', dir: path.join(projectRoot, 'gateways', 'slack') },
  { name: '@apex/gateway-discord', dir: path.join(projectRoot, 'gateways', 'discord') },
  { name: '@apex/macos-node', dir: path.join(projectRoot, 'nodes', 'macos') },
]

function listSdkPluginEntrypoints() {
  const pluginsDir = path.join(srcDir, 'plugins')
  if (!fs.existsSync(pluginsDir)) return []
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const p = path.join(pluginsDir, entry.name, 'index.ts')
    if (fs.existsSync(p)) out.push(p)
  }
  return out
}

function copyFileIfExists(from, to) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function copyPluginManifests() {
  const pluginsDir = path.join(srcDir, 'plugins')
  if (!fs.existsSync(pluginsDir)) return
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    copyFileIfExists(
      path.join(pluginsDir, entry.name, 'manifest.json'),
      path.join(distDir, 'plugins', entry.name, 'manifest.json'),
    )
  }
}

function listAllTsFiles(dir) {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listAllTsFiles(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

async function buildWorkspacePackages() {
  for (const pkg of WORKSPACE_PACKAGES) {
    const pkgSrc = path.join(pkg.dir, 'src')
    const outdir = path.join(pkg.dir, 'dist')
    if (!fs.existsSync(pkgSrc)) continue

    const entryPoints = listAllTsFiles(pkgSrc)
    if (entryPoints.length === 0) continue

    fs.mkdirSync(outdir, { recursive: true })

    // Compile every .ts file (not only index.ts) so e.g. core/brain/dist/config stays in sync.
    await build({
      entryPoints,
      outdir,
      outbase: pkgSrc,
      entryNames: '[dir]/[name]',
      bundle: false,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      sourcemap: true,
      logLevel: 'info',
      charset: 'utf8',
    })
  }
}

async function main() {
  fs.rmSync(distDir, { recursive: true, force: true })

  // We compile the whole src tree so `require("./doctor")`-style relative imports
  // keep working without bundling.
  const entryPoints = listAllTsFiles(srcDir)

  await build({
    entryPoints,
    outdir: distDir,
    outbase: srcDir, // preserve src/ folder structure inside dist/
    entryNames: '[dir]/[name]',
    // Important: do NOT bundle. This repo depends on native `.node` addons and
    // optional requires (pty.js/term.js/etc). Bundling makes those fail at build time.
    bundle: false,
    platform: 'node',
    format: 'cjs', // repo tsconfig targets CommonJS and package.json has no "type":"module"
    target: 'node20',
    sourcemap: true,
    logLevel: 'info',
    charset: 'utf8',
  })

  // Production-optimized single-file CLI bundle (keeps non-bundled dist/ for dev safety).
  // Note: bundling can break native addons/optional requires if not marked external.
  await build({
    entryPoints: [path.join(srcDir, 'cliBundle.ts')],
    outfile: path.join(distDir, 'cli.bundle.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node25',
    minify: true,
    treeShaking: true,
    sourcemap: true,
    logLevel: 'info',
    charset: 'utf8',
    external: [
      // Native addons / platform glue
      '@apex/macos-node',
      'better-sqlite3',
      // LanceDB native bindings
      '@lancedb/*',
      // pdf-parse pulls in pdfjs that assumes DOM-ish globals; keep it runtime-required.
      'pdf-parse',
      'pdfjs-dist',
      // Optional runtime deps that may be installed conditionally
      'puppeteer',
      'ts-node',
    ],
  })

  copyPluginManifests()
  await buildWorkspacePackages()
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
