import { TaskEnvelope, TaskResult } from '../types';
import { logger } from '../utils/logger';

type TaskHandler = (task: TaskEnvelope) => Promise<TaskResult>;

export class TaskQueue {
  private queue = Promise.resolve();
  private activeCount = 0;
  private pendingCount = 0;

  constructor(private readonly handler: TaskHandler) {}

  enqueue(task: TaskEnvelope): Promise<TaskResult> {
    this.pendingCount += 1;
    const run = this.queue.then(async () => {
      this.pendingCount -= 1;
      this.activeCount += 1;
      logger.system(`Queue processing ${task.source}:${task.id}`);
      try {
        const result = await this.handler(task);
        logger.system(`Queue finished ${task.source}:${task.id}`);
        return result;
      } finally {
        this.activeCount = Math.max(0, this.activeCount - 1);
      }
    });

    this.queue = run.then(() => undefined).catch((error: any) => {
      logger.error(`Queue failed ${task.source}:${task.id}: ${error.message}`);
    });

    return run;
  }

  getActiveTaskCount(): number {
    return this.activeCount;
  }

  getPendingTaskCount(): number {
    return this.pendingCount;
  }

  getSnapshot(): { active: number; pending: number } {
    return {
      active: this.activeCount,
      pending: this.pendingCount,
    };
  }
}
