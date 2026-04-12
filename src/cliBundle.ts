import { formatApexVersionLine } from './cliVersion'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  // Only treat as version when it's the first token (avoid `apex daemon --version` etc.).
  // Include `version` here so we don't lazy-load cli.js (heavy deps) for a one-line print.
  const first = argv[0]
  if (first === '--version' || first === '-v' || first === 'version') {
    process.stdout.write(`${formatApexVersionLine()}\n`)
    return
  }

  // Lazy-load the real CLI so `--version` / `-v` / `version` don't trigger heavyweight imports
  // (pdfjs DOM polyfills, native modules, etc.).
  const mod = await import('./cli.js')
  await mod.runCliMain()
}

void main()
