import { fileOrganizePreview } from './tools/fsAdvanced'
import { runFilesApplyCli } from './filesApplyCli'

type PreviewResult = Awaited<ReturnType<typeof fileOrganizePreview.execute>>

/** One-line reminder for stderr on usage errors. */
export const FILES_PREVIEW_SAFETY =
  'Preview is read-only (no mkdir, no moves). Run apex files apply … after you confirm, or use fs_mv / the agent.'

const PREVIEW_USAGE =
  'Usage: apex files preview <sourceDir> <baseTargetDir> [--json] [--verbose] [--pattern <glob>] [--extensions <csv>] [--max-files <n>]'

function printPreviewUsageTo(write: (line: string) => void): void {
  write(PREVIEW_USAGE)
  write(FILES_PREVIEW_SAFETY)
}

/** Shown for `apex files`, `apex files help`, and `apex help` (see cliHelp). */
export function printFilesCliHelp(write: (line: string) => void = console.log): void {
  write('Apex files')
  write('')
  write('  preview <sourceDir> <baseTargetDir> [options]')
  write('      Plan sorting immediate files into category folders under <baseTargetDir>.')
  write(`      ${FILES_PREVIEW_SAFETY}`)
  write('')
  write('  Options: --json  --verbose|-v  --pattern <glob>  --extensions <csv>  --max-files <n>')
  write('')
  write('  apply <sourceDir> <baseTargetDir> [options]')
  write('  apply --from-json <preview.json> [options]')
  write('      Execute moves (same layout as preview). Requires --yes, or --dry-run to print only.')
  write('      --on-collision error|skip|suffix   (default: error)')
  write('')
  write('Examples:')
  write('  apex files preview ~/Downloads ~/Downloads/Sorted')
  write('  apex files preview ~/Downloads ~/Downloads/Sorted --json > plan.json')
  write('  apex files apply ~/Downloads ~/Downloads/Sorted --dry-run')
  write('  apex files apply --from-json plan.json --yes')
  write('')
  write('See also: apex help')
}

async function runFilesPreviewCli(rest: string[]): Promise<number> {
  if (rest.includes('--help') || rest.includes('-h')) {
    printPreviewUsageTo(console.log)
    return 0
  }

  let json = false
  let verbose = false
  let pattern: string | undefined
  let extensions: string | undefined
  let maxFiles: number | undefined
  const positionals: string[] = []

  const args = rest
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--json') {
      json = true
      continue
    }
    if (a === '--verbose' || a === '-v') {
      verbose = true
      continue
    }
    if (a === '--pattern') {
      pattern = args[++i]
      if (pattern === undefined) {
        console.error('apex files preview: --pattern requires a value')
        printPreviewUsageTo(console.error)
        return 1
      }
      continue
    }
    if (a === '--extensions') {
      extensions = args[++i]
      if (extensions === undefined) {
        console.error('apex files preview: --extensions requires a value')
        printPreviewUsageTo(console.error)
        return 1
      }
      continue
    }
    if (a === '--max-files') {
      const raw = args[++i]
      if (raw === undefined || !/^\d+$/.test(raw)) {
        console.error('apex files preview: --max-files requires a positive integer')
        printPreviewUsageTo(console.error)
        return 1
      }
      maxFiles = Number.parseInt(raw, 10)
      continue
    }
    if (a.startsWith('-')) {
      console.error(`apex files preview: unknown option ${a}`)
      printPreviewUsageTo(console.error)
      return 1
    }
    positionals.push(a)
  }

  if (positionals.length < 2) {
    printPreviewUsageTo(console.error)
    return 1
  }

  const [sourceDir, baseTargetDir] = positionals

  const raw = (await fileOrganizePreview.execute({
    sourceDir,
    baseTargetDir,
    pattern,
    extensions,
    maxFiles,
  })) as PreviewResult

  if (!raw.success) {
    console.error((raw as { error?: string }).error ?? 'preview failed')
    return 1
  }

  if (json) {
    console.log(JSON.stringify(raw, null, 2))
    return 0
  }

  console.log(raw.message ?? '')
  const warnings = (raw as { warnings?: string[] }).warnings
  if (warnings?.length) {
    for (const w of warnings) {
      console.error(`Warning: ${w}`)
    }
  }

  if (verbose) {
    const moves = (raw as { proposedMoves?: { fileName: string; to: string; bucket: string }[] })
      .proposedMoves
    if (moves?.length) {
      for (const m of moves) {
        console.log(`${m.fileName} → ${m.to} [${m.bucket}]`)
      }
    }
  }

  return 0
}

export async function runFilesCli(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv

  if (sub === undefined || sub.toLowerCase() === 'help' || sub === '--help' || sub === '-h') {
    printFilesCliHelp()
    return 0
  }

  const subLower = sub.toLowerCase()
  if (subLower === 'preview') {
    return runFilesPreviewCli(rest)
  }
  if (subLower === 'apply') {
    return runFilesApplyCli(rest)
  }

  console.error(`Unknown files subcommand: ${sub}`)
  console.error('')
  printFilesCliHelp(console.error)
  return 1
}
