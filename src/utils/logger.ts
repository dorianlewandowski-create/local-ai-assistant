export type ChatRole = 'user' | 'assistant';
export type MonologueKind = 'thought' | 'plan' | 'reflection' | 'tool' | 'tool_result' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggerSink {
  appendChat(role: ChatRole, text: string): void;
  appendMonologue(kind: MonologueKind, text: string): void;
  setStatus(text: string): void;
}

export type LogEntry = { channel: string; message: string; timestamp: string };
export type LogListener = (entry: LogEntry) => void;

export interface LoggerMirror {
  write(channel: string, message: string): void;
}

class Logger {
  private sinks: LoggerSink[] = [];
  private listeners: LogListener[] = [];
  private mirror: LoggerMirror | null = null;
  private consolePatched = false;
  private readonly originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  addSink(sink: LoggerSink) {
    this.sinks.push(sink);
  }

  removeSink(sink: LoggerSink) {
    this.sinks = this.sinks.filter((s) => s !== sink);
  }

  addListener(listener: LogListener) {
    this.listeners.push(listener);
  }

  removeListener(listener: LogListener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  setSink(sink: LoggerSink | null) {
    this.sinks = sink ? [sink] : [];
  }

  setMirror(mirror: LoggerMirror | null) {
    this.mirror = mirror;
  }

  private notifyListeners(channel: string, message: string) {
    const entry: LogEntry = { channel, message, timestamp: new Date().toISOString() };
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  patchConsole() {
    if (this.consolePatched) {
      return;
    }

    console.log = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      this.notifyListeners('INFO', text);
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('info', text);
        }
        return;
      }
      this.originalConsole.log(...args);
    };

    console.warn = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      this.notifyListeners('WARN', text);
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('warn', text);
        }
        return;
      }
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      this.notifyListeners('ERROR', text);
      if (this.sinks.length > 0) {
        for (const sink of this.sinks) {
          sink.appendMonologue('error', text);
        }
        return;
      }
      this.originalConsole.error(...args);
    };

    this.consolePatched = true;
  }

  restoreConsole() {
    if (!this.consolePatched) {
      return;
    }

    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    this.consolePatched = false;
  }

  chat(role: ChatRole, text: string) {
    this.mirror?.write(role.toUpperCase(), text);
    this.notifyListeners(role.toUpperCase(), text);
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.appendChat(role, text);
      }
      return;
    }

    console.log(text);
  }

  thought(text: string) {
    this.monologue('thought', text);
  }

  plan(text: string) {
    this.monologue('plan', text);
  }

  reflection(text: string) {
    this.monologue('reflection', text);
  }

  tool(text: string) {
    this.monologue('tool', text);
  }

  toolResult(text: string) {
    this.monologue('tool_result', text);
  }

  system(text: string) {
    this.monologue('info', text);
  }

  debug(text: string) {
    this.monologue('debug', text);
  }

  warn(text: string) {
    this.monologue('warn', text);
  }

  error(text: string) {
    this.monologue('error', text);
  }

  monologue(kind: MonologueKind, text: string) {
    this.mirror?.write(kind.toUpperCase(), text);
    this.notifyListeners(kind.toUpperCase(), text);
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.appendMonologue(kind, text);
      }
      return;
    }

    const method = kind === 'error' ? console.error : console.log;
    method(text);
  }

  status(text: string) {
    this.mirror?.write('STATUS', text);
    this.notifyListeners('STATUS', text);
    if (this.sinks.length > 0) {
      for (const sink of this.sinks) {
        sink.setStatus(text);
      }
      return;
    }

    console.log(text);
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

export const logger = new Logger();
