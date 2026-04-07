import { TaskQueue } from './taskQueue';
import { sessionStore } from './sessionStore';
import { runtimeSecurityState } from '../security/runtimeState';
import { createAdminCommandHandler } from './adminCommands';
import { createDashboardServer } from '../web/dashboard';
import { runtimeServices } from './services';
import { createRuntimeApi, RuntimeApi } from './api';

export interface PendingApprovalCounter {
  getPendingApprovalCount(): number;
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
  const dashboard = createDashboardServer(api);

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
