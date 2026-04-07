import { AuthorizationRequest } from '../types';

export interface PendingApprovalSummary {
  id: string;
  source: AuthorizationRequest['source'];
  sourceId?: string;
  toolName: string;
  permissionClass: AuthorizationRequest['permissionClass'];
  reason: string;
  expiresAt?: string;
}

interface PendingApproval {
  request: AuthorizationRequest;
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

export class NativeApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();

  getPendingCount(): number {
    return this.pending.size;
  }

  listPending(): PendingApprovalSummary[] {
    return Array.from(this.pending.values()).map(({ request }) => ({
      id: request.id,
      source: request.source,
      sourceId: request.sourceId,
      toolName: request.toolName,
      permissionClass: request.permissionClass,
      reason: request.reason,
      expiresAt: request.expiresAt,
    }));
  }

  async request(request: AuthorizationRequest, sendPrompt: (request: AuthorizationRequest) => Promise<void>): Promise<boolean> {
    await sendPrompt(request);

    return new Promise<boolean>((resolve) => {
      const expiresAt = request.expiresAt ? new Date(request.expiresAt).getTime() : Date.now() + 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(false);
      }, Math.max(1, expiresAt - Date.now()));

      this.pending.set(request.id, {
        request,
        resolve,
        timeout,
      });
    });
  }

  settle(id: string, approved: boolean): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.resolve(approved);
    return true;
  }

  stop(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.pending.clear();
  }
}
