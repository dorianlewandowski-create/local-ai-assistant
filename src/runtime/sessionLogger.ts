import fs from 'fs'
import path from 'path'

const SESSION_DIR = path.join(process.cwd(), 'data', 'sessions')

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function timestampForLine() {
  return new Date().toISOString()
}

export class SessionLogger {
  private stream: fs.WriteStream | null = null
  private sessionPath: string | null = null

  start() {
    if (this.stream) {
      return this.sessionPath
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true })
    this.sessionPath = path.join(SESSION_DIR, `session-${timestampForFile()}.log`)
    this.stream = fs.createWriteStream(this.sessionPath, { flags: 'a' })
    this.write('SYSTEM', 'Session started')
    return this.sessionPath
  }

  write(channel: string, message: string) {
    if (!this.stream) {
      this.start()
    }

    this.stream?.write(`[${timestampForLine()}] [${channel}] ${message}\n`)
  }

  stop() {
    if (!this.stream) {
      return
    }

    this.write('SYSTEM', 'Session ended')
    this.stream.end()
    this.stream = null
  }

  getPath() {
    return this.sessionPath
  }
}

export const sessionLogger = new SessionLogger()
