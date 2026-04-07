import { TaskQueue } from './taskQueue';
import { logger } from '../utils/logger';
import { config } from '../config';

const INTERNAL_REVIEW_PROMPT = 'Internal Review: Access the calendar for today, fetch the current weather forecast, and recall relevant facts from Memory. Identify any potential issues, such as bad weather conflicting with outdoor plans or stress factors involving pets. Only notify the user if you find a meaningful Contextual Correlation that supports a useful proactive suggestion. If nothing meaningful is found, do not send a notification and finish quietly.';
const INTERNAL_REVIEW_SYSTEM_PROMPT = 'Hidden system instruction for proactive planning. This is an internal review, not a user request. Check today\'s calendar, current weather, and relevant memory together. Avoid spam. Only call send_system_notification when there is a meaningful contextual correlation that is specific, actionable, and not a duplicate of a recent proactive alert. Otherwise finish without notifying.';

export function createProactiveScheduler(taskQueue: TaskQueue, onReviewComplete?: () => void) {
  let lastMorningReviewKey = '';

  const runReview = (reason: 'interval' | 'morning') => {
    void taskQueue.enqueue({
      id: `proactive-review-${reason}-${Date.now()}`,
      source: 'scheduler',
      sourceId: 'proactive-review',
      prompt: INTERNAL_REVIEW_PROMPT,
      supplementalSystemPrompt: INTERNAL_REVIEW_SYSTEM_PROMPT,
      trackProactiveNotifications: true,
      metadata: { reason },
      timeoutMs: 90_000,
    }).then((result) => {
      logger.chat('assistant', `[Proactive Review] ${result.response}`);
      onReviewComplete?.();
    }).catch((error: any) => {
      logger.error(`Scheduler proactive review failed: ${error.message}`);
    });
  };

  const intervalHandle = setInterval(() => {
    runReview('interval');
  }, config.scheduler.proactiveReviewIntervalMs);

  const morningHandle = setInterval(() => {
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (now.getHours() === config.scheduler.morningReviewHour && lastMorningReviewKey !== currentKey) {
      lastMorningReviewKey = currentKey;
      runReview('morning');
    }
  }, 60 * 1000);

  return {
    start() {
      const now = new Date();
      const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      if (now.getHours() === config.scheduler.morningReviewHour) {
        lastMorningReviewKey = currentKey;
        runReview('morning');
      }
    },
    stop() {
      clearInterval(intervalHandle);
      clearInterval(morningHandle);
    },
  };
}
