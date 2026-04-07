import { TaskQueue } from './taskQueue';
import { sessionStore } from './sessionStore';
import { runtimeSecurityState } from '../security/runtimeState';
import { createAdminCommandHandler } from './adminCommands';
import { createDashboardServer } from '../web/dashboard';
import { runtimeServices } from './services';

export interface PendingApprovalCounter {
  getPendingApprovalCount(): number;
}

export interface AppContext {
  taskQueue: TaskQueue;
  sessionStore: typeof sessionStore;
  runtimeSecurityState: typeof runtimeSecurityState;
  services: typeof runtimeServices;
  adminCommands: ReturnType<typeof createAdminCommandHandler>;
  dashboard: ReturnType<typeof createDashboardServer>;
}

export function createAppContext(taskQueue: TaskQueue, approvals: PendingApprovalCounter = { getPendingApprovalCount: () => 0 }): AppContext {
  const adminCommands = createAdminCommandHandler({ taskQueue, approvals, services: runtimeServices });
  const dashboard = createDashboardServer(taskQueue, approvals, runtimeServices);

  return {
    taskQueue,
    sessionStore,
    runtimeSecurityState,
    services: runtimeServices,
    adminCommands,
    dashboard,
  };
}
