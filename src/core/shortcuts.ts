import chalk from 'chalk'

export interface Shortcut {
  name: string
  description: string
  aliases?: string[]
  execute: (args: string[], context: any) => Promise<void> | void
}

type RegisteredShortcut = Shortcut & { allNames: string[] }

const TOKYO_NIGHT = {
  apexCyan: chalk.hex('#7dcfff'),
  stormGrey: chalk.hex('#565f89'),
}

function normalizeCommandName(name: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function splitInput(input: string): { command: string; args: string[] } {
  const trimmed = String(input ?? '').trim()
  const parts = trimmed.split(/\s+/g).filter(Boolean)
  const command = normalizeCommandName(parts[0] ?? '')
  const args = parts.slice(1)
  return { command, args }
}

export class ShortcutManager {
  private readonly shortcutsByName = new Map<string, RegisteredShortcut>()
  private readonly canonical: RegisteredShortcut[] = []

  register(shortcut: Shortcut): void {
    const name = normalizeCommandName(shortcut.name)
    if (!name) {
      throw new Error('Shortcut name is required.')
    }

    const aliases = (shortcut.aliases ?? []).map(normalizeCommandName).filter(Boolean)
    const allNames = [name, ...aliases]
    const registered: RegisteredShortcut = { ...shortcut, name, aliases, allNames }

    for (const n of allNames) {
      this.shortcutsByName.set(n, registered)
    }
    this.canonical.push(registered)
  }

  async handle(input: string, context: any): Promise<boolean> {
    const { command, args } = splitInput(input)
    if (!command) return false
    const shortcut = this.shortcutsByName.get(command)
    if (!shortcut) return false
    await shortcut.execute(args, context)
    return true
  }

  formatHelp(): string {
    const lines: string[] = []
    lines.push(TOKYO_NIGHT.apexCyan.bold('Apex Shortcuts'))
    lines.push(TOKYO_NIGHT.stormGrey(''))

    const unique = this.canonical.slice().sort((a, b) => a.name.localeCompare(b.name))
    const maxNameWidth = Math.max(6, ...unique.map((s) => [s.name, ...(s.aliases ?? [])].join(', ').length))

    for (const s of unique) {
      const names = [s.name, ...(s.aliases ?? [])].join(', ')
      const left = TOKYO_NIGHT.apexCyan(names.padEnd(maxNameWidth))
      const right = TOKYO_NIGHT.stormGrey(s.description)
      lines.push(`  ${left}  ${right}`)
    }

    return lines.join('\n')
  }
}

export function registerCoreShortcuts(manager: ShortcutManager): void {
  manager.register({
    name: '/exit',
    aliases: ['/quit'],
    description: 'Exit Apex.',
    execute: () => {
      // eslint-disable-next-line no-console
      console.log(TOKYO_NIGHT.stormGrey('[Apex] Shutting down...'))
      process.exit(0)
    },
  })

  manager.register({
    name: '/clear',
    description: 'Clear the screen and redraw the dashboard.',
    execute: (_args, context) => {
      // eslint-disable-next-line no-console
      console.clear()
      context?.printDashboard?.()
    },
  })

  manager.register({
    name: '/sleep',
    description: 'Force worker threads to sleep (best-effort).',
    execute: async (_args, context) => {
      // eslint-disable-next-line no-console
      console.log(TOKYO_NIGHT.stormGrey('[Apex] Forcing worker threads to sleep...'))
      await context?.sleepWorkers?.()
    },
  })

  manager.register({
    name: '/help',
    description: 'Show this help message.',
    execute: () => {
      // eslint-disable-next-line no-console
      console.log(manager.formatHelp())
    },
  })
}
