import blessed from 'neo-blessed';
import { AuthorizationRequest } from '../../types';

function compact(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

export class GatekeeperModal {
  private readonly box: blessed.Widgets.BoxElement;
  private readonly contentBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;

  constructor(private readonly screen: blessed.Widgets.Screen) {
    this.box = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 11,
      hidden: true,
      tags: true,
      border: 'line',
      label: ' {bold}{yellow-fg} ⚠ SECURITY AUTHORIZATION  {/yellow-fg}{/bold} ',
      transparent: true as any,
      style: {
        fg: 'white',
        bg: -1 as any,
        border: { fg: 'yellow' },
      },
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
    });

    this.contentBox = blessed.box({
      parent: this.box,
      top: 1,
      left: 0,
      width: '100%-2',
      height: 7,
      tags: true,
      transparent: true as any,
      style: {
        fg: 'white',
        bg: -1 as any,
      },
    });

    this.footerBox = blessed.box({
      parent: this.box,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      align: 'center',
      content: '{yellow-fg}[Y] Authorize | [N] Deny{/yellow-fg}',
    });
  }

  show(request: AuthorizationRequest) {
    this.contentBox.setContent([
      '{yellow-fg}Tool Call{/yellow-fg}',
      compact(request.toolName),
      '',
      `{yellow-fg}Permission{/yellow-fg} ${compact(request.permissionClass)}`,
      request.expiresAt ? `{yellow-fg}Expires{/yellow-fg} ${compact(request.expiresAt)}` : '',
      '',
      '{yellow-fg}Command / Arguments{/yellow-fg}',
      compact(request.command),
      '',
      `{yellow-fg}Reason{/yellow-fg} ${compact(request.reason)}`,
    ].filter(Boolean).join('\n'));
    this.box.show();
    this.box.setFront();
    this.box.focus();
  }

  hide() {
    this.box.hide();
  }
}
