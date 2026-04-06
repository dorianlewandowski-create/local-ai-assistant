export type ChatRole = 'user' | 'assistant';
export type MonologueKind = 'thought' | 'plan' | 'reflection' | 'tool' | 'tool_result' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggerSink {
  appendChat(role: ChatRole, text: string): void;
  appendMonologue(kind: MonologueKind, text: string): void;
  setStatus(text: string): void;
}

class Logger {
  private sink: LoggerSink | null = null;
  private consolePatched = false;
  private readonly originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };

  setSink(sink: LoggerSink | null) {
    this.sink = sink;
  }

  patchConsole() {
    if (this.consolePatched) {
      return;
    }

    console.log = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      if (this.sink) {
        this.sink.appendMonologue('info', text);
        return;
      }
      this.originalConsole.log(...args);
    };

    console.warn = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      if (this.sink) {
        this.sink.appendMonologue('warn', text);
        return;
      }
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      const text = args.map((arg) => this.stringify(arg)).join(' ');
      if (this.sink) {
        this.sink.appendMonologue('error', text);
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
    if (this.sink) {
      this.sink.appendChat(role, text);
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
    if (this.sink) {
      this.sink.appendMonologue(kind, text);
      return;
    }

    const method = kind === 'error' ? console.error : console.log;
    method(text);
  }

  status(text: string) {
    if (this.sink) {
      this.sink.setStatus(text);
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
