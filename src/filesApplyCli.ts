import * as fs from 'fs/promises'
import * as path from 'path'
import { fileOrganizePreview, type ProposedMove } from './tools/fsAdvanced'

export type CollisionMode = 'error' | 'skip' | 'suffix'

const APPLY_USAGE =
  'Usage: apex files apply <sourceDir> <baseTargetDir> | apex files apply --from-json <file.json> [--dry-run] [--yes] [--on-collision error|skip|suffix] [--pattern …] [--extensions …] [--max-files n]'

export function printApplyUsageTo(write: (line: string) => void): void {
  write(APPLY_USAGE)
  write(
    'Moves immediate files into category folders under <baseTargetDir>. Requires --yes to execute, or --dry-run to print planned moves.',
  )
  write('Default --on-collision error: aborts if a destination path already exists.')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Next free path: prefers `preferred`; if taken (disk or reserved), uses `name (1).ext`, etc. */
export async function allocateUniqueDestination(preferred: string, reserved: Set<string>): Promise<string> {
  const dir = path.dirname(preferred)
  const base = path.basename(preferred)
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  for (let n = 0; n < 10_000; n++) {
    const candidate = n === 0 ? preferred : path.join(dir, `${stem} (${n})${ext}`)
    if (reserved.has(candidate)) continue
    if (await pathExists(candidate)) continue
    reserved.add(candidate)
    return candidate
  }
  throw new Error(`Could not allocate a unique path under ${dir}`)
}

async function moveFile(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  try {
    await fs.rename(source, destination)
  } catch (err: any) {
    if (err?.code === 'EXDEV') {
      await fs.cp(source, destination)
      await fs.rm(source, { recursive: false, force: true })
    } else {
      throw err
    }
  }
}

type ParsedApply = {
  dryRun: boolean
  yes: boolean
  collision: CollisionMode
  fromJson: string | undefined
  pattern: string | undefined
  extensions: string | undefined
  maxFiles: number | undefined
  positionals: string[]
}

function parseApplyArgs(args: string[]): ParsedApply | { error: string } {
  let dryRun = false
  let yes = false
  let collision: CollisionMode = 'error'
  let fromJson: string | undefined
  let pattern: string | undefined
  let extensions: string | undefined
  let maxFiles: number | undefined
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dry-run') {
      dryRun = true
      continue
    }
    if (a === '--yes') {
      yes = true
      continue
    }
    if (a === '--on-collision') {
      const v = args[++i]?.toLowerCase()
      if (v !== 'error' && v !== 'skip' && v !== 'suffix') {
        return { error: 'apex files apply: --on-collision must be error, skip, or suffix' }
      }
      collision = v as CollisionMode
      continue
    }
    if (a === '--from-json') {
      fromJson = args[++i]
      if (!fromJson) {
        return { error: 'apex files apply: --from-json requires a path' }
      }
      continue
    }
    if (a === '--pattern') {
      pattern = args[++i]
      if (pattern === undefined) {
        return { error: 'apex files apply: --pattern requires a value' }
      }
      continue
    }
    if (a === '--extensions') {
      extensions = args[++i]
      if (extensions === undefined) {
        return { error: 'apex files apply: --extensions requires a value' }
      }
      continue
    }
    if (a === '--max-files') {
      const raw = args[++i]
      if (raw === undefined || !/^\d+$/.test(raw)) {
        return { error: 'apex files apply: --max-files requires a positive integer' }
      }
      maxFiles = Number.parseInt(raw, 10)
      continue
    }
    if (a.startsWith('-')) {
      return { error: `apex files apply: unknown option ${a}` }
    }
    positionals.push(a)
  }

  return { dryRun, yes, collision, fromJson, pattern, extensions, maxFiles, positionals }
}

function isProposedMove(x: unknown): x is ProposedMove {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.from === 'string' && typeof o.to === 'string'
}

async function loadMovesFromJson(filePath: string): Promise<ProposedMove[] | { error: string }> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (e: any) {
    return { error: e?.message ?? String(e) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e: any) {
    return { error: `Invalid JSON: ${e?.message ?? e}` }
  }
  const moves = (parsed as { proposedMoves?: unknown }).proposedMoves
  if (!Array.isArray(moves)) {
    return { error: 'JSON must contain a proposedMoves array (e.g. output of apex files preview --json).' }
  }
  const out: ProposedMove[] = []
  for (const m of moves) {
    if (!isProposedMove(m)) {
      return { error: 'Each proposedMoves entry needs string from and to paths.' }
    }
    out.push({
      fileName:
        typeof (m as ProposedMove).fileName === 'string' ? (m as ProposedMove).fileName : path.basename(m.to),
      from: m.from,
      to: m.to,
      bucket: typeof (m as ProposedMove).bucket === 'string' ? (m as ProposedMove).bucket : 'Other',
      destinationExists: !!(m as ProposedMove).destinationExists,
    })
  }
  return out
}

type PlannedMove = { from: string; to: string; originalTo: string }

async function planMoves(
  moves: ProposedMove[],
  collision: CollisionMode,
): Promise<{ planned: PlannedMove[]; skipped: string[]; error?: string }> {
  const skipped: string[] = []
  const planned: PlannedMove[] = []

  if (collision === 'error') {
    const reserved = new Set<string>()
    for (const m of moves) {
      if (!(await pathExists(m.from))) {
        return { planned: [], skipped, error: `Source missing (abort): ${m.from}` }
      }
      if (await pathExists(m.to)) {
        return {
          planned: [],
          skipped,
          error: `Destination exists (abort): ${m.to}\nUse --on-collision skip or suffix, or remove/rename the existing file.`,
        }
      }
      if (reserved.has(m.to)) {
        return { planned: [], skipped, error: `Duplicate destination in plan (abort): ${m.to}` }
      }
      reserved.add(m.to)
      planned.push({ from: m.from, to: m.to, originalTo: m.to })
    }
    return { planned, skipped }
  }

  if (collision === 'skip') {
    const reserved = new Set<string>()
    for (const m of moves) {
      if (!(await pathExists(m.from))) {
        skipped.push(`missing source: ${m.from}`)
        continue
      }
      if ((await pathExists(m.to)) || reserved.has(m.to)) {
        skipped.push(`destination taken: ${m.to}`)
        continue
      }
      reserved.add(m.to)
      planned.push({ from: m.from, to: m.to, originalTo: m.to })
    }
    return { planned, skipped }
  }

  const reserved = new Set<string>()
  for (const m of moves) {
    if (!(await pathExists(m.from))) {
      skipped.push(`missing source: ${m.from}`)
      continue
    }
    const dest = await allocateUniqueDestination(m.to, reserved)
    planned.push({ from: m.from, to: dest, originalTo: m.to })
  }
  return { planned, skipped }
}

export async function runFilesApplyCli(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printApplyUsageTo(console.log)
    return 0
  }

  const parsed = parseApplyArgs(args)
  if ('error' in parsed) {
    console.error(parsed.error)
    printApplyUsageTo(console.error)
    return 1
  }

  const { dryRun, yes, collision, fromJson, pattern, extensions, maxFiles, positionals } = parsed

  if (!dryRun && !yes) {
    console.error('Refusing to move files without --yes (or use --dry-run to show planned moves).')
    printApplyUsageTo(console.error)
    return 1
  }

  if (fromJson && positionals.length > 0) {
    console.error('apex files apply: do not pass source/target paths when using --from-json')
    printApplyUsageTo(console.error)
    return 1
  }

  let moves: ProposedMove[]

  if (fromJson) {
    const loaded = await loadMovesFromJson(fromJson)
    if ('error' in loaded) {
      console.error(loaded.error)
      return 1
    }
    moves = loaded
  } else {
    if (positionals.length < 2) {
      printApplyUsageTo(console.error)
      return 1
    }
    const [sourceDir, baseTargetDir] = positionals
    const raw = await fileOrganizePreview.execute({
      sourceDir,
      baseTargetDir,
      pattern,
      extensions,
      maxFiles,
    })
    if (!raw.success) {
      console.error((raw as { error?: string }).error ?? 'preview failed')
      return 1
    }
    moves = ((raw as { proposedMoves?: ProposedMove[] }).proposedMoves ?? []).slice()
  }

  if (moves.length === 0) {
    console.log('Nothing to move.')
    return 0
  }

  const plan = await planMoves(moves, collision)
  if (plan.error) {
    console.error(plan.error)
    return 1
  }

  for (const s of plan.skipped) {
    console.error(`Skipped: ${s}`)
  }

  for (const p of plan.planned) {
    if (dryRun) {
      const extra = p.to !== p.originalTo ? ` (resolved from ${p.originalTo})` : ''
      console.log(`would move: ${p.from} -> ${p.to}${extra}`)
    } else {
      await moveFile(p.from, p.to)
      const extra = p.to !== p.originalTo ? ` (resolved from ${p.originalTo})` : ''
      console.log(`moved: ${p.from} -> ${p.to}${extra}`)
    }
  }

  return 0
}
