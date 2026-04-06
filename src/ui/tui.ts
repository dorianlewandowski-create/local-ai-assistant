import blessed from 'neo-blessed';
import { AuthorizationRequest } from '../types';
import { ChatRole, LoggerSink, MonologueKind } from '../utils/logger';
import { GatekeeperModal } from './components/Gatekeeper';

const MAX_LINES = 500;
const LIGHT_BORDER = {
  top: '─',
  bottom: '─',
  left: '│',
  right: '│',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
};

function escapeTags(value: string): string {
  return value.replace(/[{}]/g, '').trim();
}

function nowStamp(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function compactText(value: string): string {
  return escapeTags(value).replace(/\s+/g, ' ').trim();
}

export class OpenMacTui implements LoggerSink {
  private readonly screen: blessed.Widgets.Screen;
  private readonly layout: blessed.Widgets.LayoutElement;
  private readonly chatBox: blessed.Widgets.BoxElement;
  private readonly reasoningBox: blessed.Widgets.BoxElement;
  private readonly systemBox: blessed.Widgets.BoxElement;
  private readonly statusBar: blessed.Widgets.BoxElement;
  private readonly inputWrapper: blessed.Widgets.BoxElement;
  private readonly input: blessed.Widgets.TextboxElement;
  private readonly placeholder: blessed.Widgets.BoxElement;
  private readonly gatekeeper: GatekeeperModal;
  private readonly chatLines: string[] = [];
  private readonly reasoningLines: string[] = [];
  private readonly systemLines: string[] = [];
  private renderQueued = false;
  private onSubmitHandler: ((value: string) => void) | null = null;
  private onExitHandler: (() => void) | null = null;
  private activePanel: 'chat' | 'reasoning' | 'system' | 'input' = 'input';
  private pendingAuthorization: { resolve: (approved: boolean) => void } | null = null;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: 'OpenMac | OS Agent v0.6.0',
      dockBorders: true,
      style: {
        bg: 'black',
      },
    });

    this.layout = blessed.layout({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-2',
      layout: 'grid',
    });

    this.chatBox = blessed.box({
      parent: this.layout,
      width: '60%',
      height: '100%',
      border: 'line',
      tags: true,
      label: ' {bold}{blue-fg} openmac{/blue-fg}{/bold} ',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      scrollbar: { ch: ' ' },
      style: {
        border: { fg: 'blue' },
        fg: 'white',
      },
      chars: LIGHT_BORDER,
      content: '{gray-fg}Awaiting Command...{/gray-fg}',
    });

    const rightColumn = blessed.layout({
      parent: this.layout,
      width: '40%',
      height: '100%',
      layout: 'grid',
    });

    this.reasoningBox = blessed.box({
      parent: rightColumn,
      width: '100%',
      height: '50%',
      border: 'line',
      tags: true,
      label: ' {bold}{blue-fg}rsn{/blue-fg}{/bold} ',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      scrollbar: { ch: ' ' },
      style: {
        border: { fg: 'gray' },
        fg: 'white',
      },
      chars: LIGHT_BORDER,
      content: '{gray-fg}Idle...{/gray-fg}',
    });

    this.systemBox = blessed.box({
      parent: rightColumn,
      width: '100%',
      height: '50%',
      border: 'line',
      tags: true,
      label: ' {bold}{blue-fg}io{/blue-fg}{/bold} ',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      scrollbar: { ch: ' ' },
      style: {
        border: { fg: 'gray' },
        fg: 'white',
      },
      chars: LIGHT_BORDER,
      content: '{gray-fg}Idle...{/gray-fg}',
    });

    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
      },
      content: ' pulse:· idle | openmac standby',
    });

    this.inputWrapper = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });

    this.input = blessed.textbox({
      parent: this.inputWrapper,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });

    this.placeholder = blessed.box({
      parent: this.inputWrapper,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      mouse: false,
      content: '{gray-fg}> [ Command OpenMac...]{/gray-fg}',
    });

    this.gatekeeper = new GatekeeperModal(this.screen);

    this.input.on('keypress', () => {
      this.updatePlaceholder();
    });

    this.input.on('submit', (value: string) => {
      const trimmed = value.trim();
      this.input.clearValue();
      this.updatePlaceholder();
      this.queueRender();

      if (!trimmed || !this.onSubmitHandler) {
        return;
      }

      this.onSubmitHandler(trimmed);
      this.focusPanel('input');
    });

    this.screen.key(['h'], () => this.moveFocus(-1));
    this.screen.key(['l'], () => this.moveFocus(1));
    this.screen.key(['i'], () => this.focusPanel('input'));
    this.screen.key(['j'], () => this.scrollActivePanel(2));
    this.screen.key(['k'], () => this.scrollActivePanel(-2));
    this.screen.key(['g'], () => this.scrollActivePanelToTop());
    this.screen.key(['G'], () => this.scrollActivePanelToBottom());
    this.screen.key(['escape', 'C-c'], () => this.onExitHandler?.());
    this.screen.on('keypress', (_ch, key) => {
      if (!this.pendingAuthorization) {
        return;
      }

      if (key.full === 'y' || key.full === 'Y') {
        this.resolveAuthorization(true);
      } else if (key.full === 'n' || key.full === 'N') {
        this.resolveAuthorization(false);
      }
    });

    this.focusPanel('input');
    this.queueRender();
  }

  onSubmit(handler: (value: string) => void) {
    this.onSubmitHandler = handler;
  }

  onExit(handler: () => void) {
    this.onExitHandler = handler;
  }

  appendChat(role: ChatRole, text: string): void {
    const color = role === 'user' ? 'gray' : 'white';
    const prefix = role === 'user' ? '>' : '';
    this.chatLines.push(`{gray-fg}${nowStamp()}{/gray-fg} {${color}-fg}${prefix} ${compactText(text)}{/${color}-fg}`);
    this.trimLines(this.chatLines);
    this.chatBox.setContent(this.chatLines.join('\n'));
    this.chatBox.setScrollPerc(100);
    this.queueRender();
  }

  appendMonologue(kind: MonologueKind, text: string): void {
    const styles: Record<MonologueKind, { color: string; label: string; target: 'reasoning' | 'system' }> = {
      thought: { color: 'yellow', label: 'Thought', target: 'reasoning' },
      plan: { color: 'cyan', label: 'Plan', target: 'reasoning' },
      reflection: { color: 'yellow', label: 'Reflect', target: 'reasoning' },
      tool: { color: 'magenta', label: 'Exec', target: 'system' },
      tool_result: { color: 'green', label: 'OK', target: 'system' },
      debug: { color: 'gray', label: 'Debug', target: 'system' },
      info: { color: 'blue', label: 'Info', target: 'system' },
      warn: { color: 'yellow', label: 'Warn', target: 'system' },
      error: { color: 'red', label: 'Err', target: 'system' },
    };

    const style = styles[kind];
    const lines = style.target === 'reasoning' ? this.reasoningLines : this.systemLines;
    const box = style.target === 'reasoning' ? this.reasoningBox : this.systemBox;
    lines.push(`{gray-fg}${nowStamp()}{/gray-fg} {${style.color}-fg}${style.label} ${compactText(text)}{/${style.color}-fg}`);
    this.trimLines(lines);
    box.setContent(lines.join('\n'));
    box.setScrollPerc(100);
    this.queueRender();
  }

  setStatus(text: string): void {
    this.statusBar.setContent(` ${text}`);
    this.queueRender();
  }

  destroy() {
    this.screen.destroy();
  }

  async requestAuthorization(request: AuthorizationRequest): Promise<boolean> {
    (this.screen as any).saveFocus?.();
    this.input.hide();
    this.placeholder.hide();
    this.gatekeeper.show(request);
    this.queueRender();

    return new Promise<boolean>((resolve) => {
      this.pendingAuthorization = { resolve };
    });
  }

  private queueRender() {
    if (this.renderQueued) {
      return;
    }

    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.screen.render();
    });
  }

  private trimLines(lines: string[]) {
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES);
    }
  }

  private updatePlaceholder() {
    if (this.pendingAuthorization) {
      return;
    }

    const value = this.input.getValue();
    if (value.trim().length > 0) {
      this.placeholder.hide();
    } else {
      this.placeholder.show();
    }
    this.queueRender();
  }

  private updatePanelFocus(active: 'chat' | 'reasoning' | 'system' | 'input') {
    this.chatBox.style.border.fg = active === 'chat' ? 'blue' : 'gray';
    this.reasoningBox.style.border.fg = active === 'reasoning' ? 'blue' : 'gray';
    this.systemBox.style.border.fg = active === 'system' ? 'blue' : 'gray';
    this.inputWrapper.style.fg = active === 'input' ? 'blue' : 'white';
    this.queueRender();
  }

  private moveFocus(direction: -1 | 1) {
    const order: Array<'chat' | 'reasoning' | 'system' | 'input'> = ['chat', 'reasoning', 'system', 'input'];
    const currentIndex = order.indexOf(this.activePanel);
    const nextIndex = (currentIndex + direction + order.length) % order.length;
    this.focusPanel(order[nextIndex]);
  }

  private focusPanel(panel: 'chat' | 'reasoning' | 'system' | 'input') {
    this.activePanel = panel;
    if (panel === 'input') {
      this.input.focus();
    }
    this.updatePanelFocus(panel);
  }

  private scrollActivePanel(offset: number) {
    const box = this.getScrollableForActivePanel();
    if (!box) {
      return;
    }
    box.scroll(offset);
    this.queueRender();
  }

  private scrollActivePanelToTop() {
    const box = this.getScrollableForActivePanel();
    if (!box) {
      return;
    }
    box.setScroll(0);
    this.queueRender();
  }

  private scrollActivePanelToBottom() {
    const box = this.getScrollableForActivePanel();
    if (!box) {
      return;
    }
    box.setScrollPerc(100);
    this.queueRender();
  }

  private getScrollableForActivePanel(): blessed.Widgets.BoxElement | null {
    if (this.activePanel === 'chat') {
      return this.chatBox;
    }
    if (this.activePanel === 'reasoning') {
      return this.reasoningBox;
    }
    if (this.activePanel === 'system') {
      return this.systemBox;
    }
    return null;
  }

  private resolveAuthorization(approved: boolean) {
    if (!this.pendingAuthorization) {
      return;
    }

    const { resolve } = this.pendingAuthorization;
    this.pendingAuthorization = null;
    this.gatekeeper.hide();
    this.input.show();
    this.updatePlaceholder();
    (this.screen as any).restoreFocus?.();
    this.focusPanel('input');
    resolve(approved);
  }
}
