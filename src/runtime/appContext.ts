import { TaskQueue } from './taskQueue';
import { sessionStore } from './sessionStore';
import { runtimeSecurityState } from '../security/runtimeState';
import { createAdminCommandHandler } from './adminCommands';
import { createDashboardServer } from '../web/dashboard';

export interface PendingApprovalCounter {
  getPendingApprovalCount(): number;
}

export interface AppContext {
  taskQueue: TaskQueue;
  sessionStore: typeof sessionStore;
  runtimeSecurityState: typeof runtimeSecurityState;
  adminCommands: ReturnType<typeof createAdminCommandHandler>;
  dashboard: ReturnType<typeof createDashboardServer>;
}

export function createAppContext(taskQueue: TaskQueue, approvals: PendingApprovalCounter): AppContext {
  const adminCommands = createAdminCommandHandler({ taskQueue, approvals });
  const dashboard = createDashboardServer(taskQueue, approvals);

  return {
    taskQueue,
    sessionStore,
    runtimeSecurityState,
    adminCommands,
    dashboard,
  };
}
