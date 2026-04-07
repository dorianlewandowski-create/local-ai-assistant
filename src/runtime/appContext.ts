import { TaskQueue } from './taskQueue';
import { sessionStore } from './sessionStore';
import { runtimeSecurityState } from '../security/runtimeState';
import { createAdminCommandHandler } from './adminCommands';
import { createDashboardServer } from '../web/dashboard';
import { runtimeServices } from './services';
import { createRuntimeApi, RuntimeApi } from './api';

export interface PendingApprovalCounter {
  getPendingApprovalCount(): number;
  listPendingApprovals?(): Array<{ id: string; source: string; sourceId?: string; toolName: string; permissionClass: string; command: string; reason: string; expiresAt?: string }>;
  settleApproval?(id: string, approved: boolean): boolean;
}

export interface AppContext {
  taskQueue: TaskQueue;
  sessionStore: typeof sessionStore;
  runtimeSecurityState: typeof runtimeSecurityState;
  services: typeof runtimeServices;
  api: RuntimeApi;
  adminCommands: ReturnType<typeof createAdminCommandHandler>;
  dashboard: ReturnType<typeof createDashboardServer>;
}

export function createAppContext(taskQueue: TaskQueue, approvals: PendingApprovalCounter = { getPendingApprovalCount: () => 0 }): AppContext {
  const api = createRuntimeApi(taskQueue, approvals, runtimeServices);
  const adminCommands = createAdminCommandHandler({ taskQueue, approvals, services: runtimeServices, api });
  api.setAdminCommandHandler(adminCommands);
  const dashboard = createDashboardServer();

  return {
    taskQueue,
    sessionStore,
    runtimeSecurityState,
    services: runtimeServices,
    api,
    adminCommands,
    dashboard,
  };
}
