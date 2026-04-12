export type ChatRole = 'user' | 'assistant'
export type MonologueKind =
  | 'thought'
  | 'plan'
  | 'reflection'
  | 'tool'
  | 'tool_result'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'

import fs from 'fs'
import path from 'path'

export interface LoggerSink {
  appendChat(role: ChatRole, text: string): void
  appendMonologue(kind: MonologueKind, text: string): void
  setStatus(text: string): void
}

export type LogEntry = { channel: string; message: string; timestamp: string }
export type LogListener = (entry: LogEntry) => void

export interface LoggerMirror {
  write(channel: string, message: string): void
}

class Logger {
  private sinks: LoggerSink[] = []
  private listeners: LogListener[] = []
  private mirror: LoggerMirror | null = null
  private consolePatched = false
  private readlinePrompt: { prompt(preserveCursor?: boolean): void } | null = null
  private readonly originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  }

  // Hard cap to prevent listener leaks from growing memory indefinitely if a caller
  // forgets to unregister (e.g., reconnect loops).
  private static readonly MAX_LISTENERS = 100

  addSink(sink: LoggerSink) {
    this.sinks.push(sink)
  }

  removeSink(sink: LoggerSink) {
    this.sinks = this.sinks.filter((s) => s !== sink)
  }

  addListener(listener: LogListener) {
    this.listeners.push(listener)
    if (this.listeners.length > Logger.MAX_LISTENERS) {
      this.listeners.splice(0, this.listeners.length - Logger.MAX_LISTENERS)
    }
  }

  removeListener(listener: LogListener) {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }

  setSink(sink: LoggerSink | null) {
    this.sinks = sink ? [sink] : []
  }

  setMirror(mirror: LoggerMirror | null) {
    this.mirror = mirror
  }

  /**
   * Attach a readline interface so background logs can render safely without
   * corrupting the user's active typing buffer.
   */
  attachReadline(rl: { prompt(preserveCursor?: boolean): void } | null) {
    this.readlinePrompt = rl
  }

  private writeSafelyToTty(text: string) {
    try {
      // Single-writer rule: logger never writes to stdout directly.
      // stderr is acceptable for non-interactive/machine contexts.
      process.stderr.write(`${text}\n`)
    } catch (error: any) {
      // When stdout is piped and the reader closes early (e.g. `| head`),
      // Node throws EPIPE. Treat it as a clean exit.
      if (error?.code === 'EPIPE') {
        try {
          process.exit(0)
        } catch {
          return
        }
      }
      throw error
    }
  }

  private debugEnabled(): boolean {
    const v = String(process.env.APEX_DEBUG ?? '')
      .trim()
      .toLowerCase()
    return v === '1' || v === 'true'
  }

  private writeDebugToFile(text: string) {
    try {
      const dir = path.join(process.cwd(), 'data')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'debug.log')
      fs.appendFileSync(file, `${text}\n`, { encoding: 'utf8' })
    } catch {
      // Never let debug logging crash the app.
    }
  }

  private notifyListeners(channel: string, message: string) {
    const entry: LogEntry = { channel, message, timestamp: new Date().toISOString() }
    for (const listener of this.listeners) {
      listener(entry)
    }
  }

  patchConsole() {
    if (this.consolePatched) {
      return
    }

    console.log = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ')
      this.notifyListeners('INFO', text)
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('info', text)
        }
        return
      }
      this.writeSafelyToTty(text)
    }

    console.warn = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ')
      this.notifyListeners('WARN', text)
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('warn', text)
        }
        return
      }
      this.writeSafelyToTty(text)
    }

    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ')
      this.notifyListeners('ERROR', text)
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('error', text)
        }
        return
      }
      this.writeSafelyToTty(text)
    }

    this.consolePatched = true
  }

  restoreConsole() {
    if (!this.consolePatched) {
      return
    }

    console.log = this.originalConsole.log
    console.warn = this.originalConsole.warn
    console.error = this.originalConsole.error
    this.consolePatched = false
  }

  chat(role: ChatRole, text: string) {
    this.mirror?.write(role.toUpperCase(), text)
    this.notifyListeners(role.toUpperCase(), text)
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.appendChat(role, text)
      }
      return
    }

    this.writeSafelyToTty(text)
  }

  thought(text: string) {
    this.monologue('thought', text)
  }

  plan(text: string) {
    this.monologue('plan', text)
  }

  reflection(text: string) {
    this.monologue('reflection', text)
  }

  tool(text: string) {
    this.monologue('tool', text)
  }

  toolResult(text: string) {
    this.monologue('tool_result', text)
  }

  system(text: string) {
    this.monologue('info', text)
  }

  debug(text: string) {
    // Debug is noisy. Always append to data/debug.log.
    this.writeDebugToFile(`[${new Date().toISOString()}] DEBUG ${text}`)

    // Only print/emit debug to the TTY and sinks when explicitly enabled.
    if (!this.debugEnabled()) {
      return
    }

    this.monologue('debug', text)
  }

  warn(text: string) {
    this.monologue('warn', text)
  }

  error(text: string) {
    this.monologue('error', text)
  }

  monologue(kind: MonologueKind, text: string) {
    this.mirror?.write(kind.toUpperCase(), text)
    this.notifyListeners(kind.toUpperCase(), text)
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.appendMonologue(kind, text)
      }
      return
    }

    this.writeSafelyToTty(text)
  }

  status(text: string) {
    this.mirror?.write('STATUS', text)
    this.notifyListeners('STATUS', text)
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.setStatus(text)
      }
      return
    }

    this.writeSafelyToTty(text)
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
}

export const logger = new Logger()
