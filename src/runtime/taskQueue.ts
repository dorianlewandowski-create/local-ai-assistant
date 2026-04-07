import { TaskEnvelope, TaskResult } from '../types';
import { logger } from '../utils/logger';

type TaskHandler = (task: TaskEnvelope) => Promise<TaskResult>;

interface QueuedTask {
  task: TaskEnvelope;
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
  started: boolean;
}

interface QueueState {
  key: string;
  running: boolean;
  pending: QueuedTask[];
}

export interface TaskQueueSnapshot {
  active: number;
  pending: number;
  queues: Array<{
    key: string;
    active: number;
    pending: number;
  }>;
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

export class TaskQueue {
  private readonly queues = new Map<string, QueueState>();

  constructor(private readonly handler: TaskHandler) {}

  enqueue(task: TaskEnvelope): Promise<TaskResult> {
    return new Promise<TaskResult>((resolve, reject) => {
      const queueKey = this.resolveQueueKey(task);
      const queue = this.getOrCreateQueue(queueKey);
      queue.pending.push({
        task,
        resolve,
        reject,
        cancelled: false,
        started: false,
      });

      logger.system(`Queue enqueued ${queueKey} ${task.source}:${task.id}`);
      this.runNext(queueKey);
    });
  }

  cancel(taskId: string): boolean {
    for (const [queueKey, queue] of this.queues.entries()) {
      const queuedTask = queue.pending.find((entry) => entry.task.id === taskId && !entry.started);
      if (!queuedTask) {
        continue;
      }

      queuedTask.cancelled = true;
      queue.pending = queue.pending.filter((entry) => entry !== queuedTask);
      queuedTask.reject(new Error(`Task cancelled before execution: ${taskId}`));
      logger.warn(`Queue cancelled ${queueKey} ${queuedTask.task.source}:${taskId}`);
      this.cleanupQueue(queueKey);
      return true;
    }

    return false;
  }

  getActiveTaskCount(): number {
    return Array.from(this.queues.values()).filter((queue) => queue.running).length;
  }

  getPendingTaskCount(): number {
    return Array.from(this.queues.values()).reduce((sum, queue) => sum + queue.pending.length, 0);
  }

  getSnapshot(): TaskQueueSnapshot {
    const queues = Array.from(this.queues.values())
      .map((queue) => ({
        key: queue.key,
        active: queue.running ? 1 : 0,
        pending: queue.pending.length,
      }))
      .filter((queue) => queue.active > 0 || queue.pending > 0)
      .sort((left, right) => left.key.localeCompare(right.key));

    return {
      active: this.getActiveTaskCount(),
      pending: this.getPendingTaskCount(),
      queues,
    };
  }

  private resolveQueueKey(task: TaskEnvelope): string {
    if (task.source === 'file_watcher') {
      return 'file_watcher:resident';
    }

    if (task.source === 'scheduler') {
      return 'scheduler:proactive';
    }

    if (task.source === 'terminal') {
      return `terminal:${task.sourceId || 'local'}`;
    }

    return `${task.source}:${task.sourceId || 'default'}`;
  }

  private getOrCreateQueue(key: string): QueueState {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = {
        key,
        running: false,
        pending: [],
      };
      this.queues.set(key, queue);
    }

    return queue;
  }

  private runNext(queueKey: string) {
    const queue = this.queues.get(queueKey);
    if (!queue || queue.running) {
      return;
    }

    const nextTask = queue.pending.shift();
    if (!nextTask) {
      this.cleanupQueue(queueKey);
      return;
    }

    if (nextTask.cancelled) {
      this.runNext(queueKey);
      return;
    }

    nextTask.started = true;
    queue.running = true;
    void this.executeQueuedTask(queueKey, queue, nextTask);
  }

  private async executeQueuedTask(queueKey: string, queue: QueueState, queuedTask: QueuedTask) {
    const { task } = queuedTask;
    logger.system(`Queue processing ${queueKey} ${task.source}:${task.id}`);

    try {
      const result = await this.runWithTimeout(task);
      logger.system(`Queue finished ${queueKey} ${task.source}:${task.id}`);
      queuedTask.resolve(result);
    } catch (error: any) {
      logger.error(`Queue failed ${queueKey} ${task.source}:${task.id}: ${error.message}`);
      queuedTask.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      queue.running = false;
      this.cleanupQueue(queueKey);
      this.runNext(queueKey);
    }
  }

  private async runWithTimeout(task: TaskEnvelope): Promise<TaskResult> {
    const timeoutMs = Math.max(1, task.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    return new Promise<TaskResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeoutMs}ms: ${task.id}`));
      }, timeoutMs);

      void this.handler(task)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private cleanupQueue(queueKey: string) {
    const queue = this.queues.get(queueKey);
    if (!queue) {
      return;
    }

    if (!queue.running && queue.pending.length === 0) {
      this.queues.delete(queueKey);
    }
  }
}
