import fs from 'fs'
import path from 'path'
import type readline from 'readline'
import * as rlCompat from 'readline'

export type UiState = 'IdleTyping' | 'OverlayMenu' | 'Thinking' | 'Printing'

type BufferedLine = {
  kind: 'info' | 'system' | 'warn' | 'error' | 'chat'
  text: string
  ts: number
}

/**
 * Single-writer terminal renderer for interactive readline UIs.
 *
 * Rules:
 * - Only this class writes to stdout.
 * - Background logs are buffered while not in IdleTyping.
 */
export class TerminalRenderer {
  private state: UiState = 'IdleTyping'
  private buffer: BufferedLine[] = []

  constructor(
    private readonly rl: readline.Interface,
    private readonly getPrompt: () => string,
  ) {}

  getState(): UiState {
    return this.state
  }

  setState(next: UiState) {
    this.state = next
    if (next === 'IdleTyping') {
      this.flushBuffered()
      this.safePromptRedraw()
    }
  }

  printForeground(text: string) {
    this.safeWriteLine(text)
  }

  logBackground(kind: BufferedLine['kind'], text: string) {
    const activeLineLen = String((this.rl as any)?.line ?? '').length
    // If user is mid-typing, never print above them; buffer and flush later.
    if (this.state === 'IdleTyping' && activeLineLen === 0) {
      this.safeWriteLine(text)
      return
    }
    this.buffer.push({ kind, text, ts: Date.now() })
    if (this.buffer.length > 500) {
      this.buffer.splice(0, this.buffer.length - 500)
    }
  }

  private flushBuffered() {
    if (this.buffer.length === 0) return
    const lines = this.buffer
    this.buffer = []
    for (const line of lines) {
      this.safeWriteLine(line.text)
    }
  }

  private safePromptRedraw() {
    try {
      // Force redraw prompt + current input buffer
      this.rl.setPrompt(this.getPrompt())
      this.rl.prompt(true)
    } catch {
      // ignore
    }
  }

  private safeWriteLine(text: string) {
    try {
      // Clear current line + return carriage (readline-compatible)
      rlCompat.clearLine(process.stdout, 0)
      rlCompat.cursorTo(process.stdout, 0)
      process.stdout.write(`${text}\n`)
      if (this.state === 'IdleTyping') {
        this.safePromptRedraw()
      }
    } catch (err: any) {
      this.fallbackToDebugLog(`TerminalRenderer write failed: ${err?.message ?? String(err)}`)
    }
  }

  private fallbackToDebugLog(message: string) {
    try {
      const dir = path.join(process.cwd(), 'data')
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'debug.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8')
    } catch {
      // last resort: swallow
    }
  }
}
