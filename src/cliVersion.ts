import fs from 'fs'
import path from 'path'

/**
 * Version string for CLI output, read from package.json (CWD first, then install-relative).
 * Single source of truth — do not duplicate in CLI strings.
 */
export function readApexVersionFromPackageJson(): string {
  const cwdPkg = path.join(process.cwd(), 'package.json')
  const pkgPath = fs.existsSync(cwdPkg) ? cwdPkg : path.join(__dirname, '..', 'package.json')
  const raw = fs.readFileSync(pkgPath, 'utf-8')
  const parsed = JSON.parse(raw) as { version?: string }
  return parsed.version ?? 'unknown'
}

/** One line for stdout: human- and script-friendly. */
export function formatApexVersionLine(): string {
  return `Apex ${readApexVersionFromPackageJson()}`
}
