import { AuthorizationRequest } from '../types';

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
