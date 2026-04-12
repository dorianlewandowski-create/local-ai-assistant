import { TaskQueue } from './taskQueue'
import { logger } from '../utils/logger'
import { config } from '@apex/core'
import { sendTelegramPlainMessage } from '../utils/telegramOutbound'

const INTERNAL_REVIEW_PROMPT =
  'Internal Review: Access the calendar for today, fetch the current weather, recall relevant memory, and check system health (disk space, CPU load, and battery). Identify any potential issues, such as bad weather conflicting with plans or critical system resources. Only notify the user if you find a meaningful Contextual Correlation that supports a useful proactive suggestion. If nothing meaningful is found, do not send a notification and finish quietly.'
const INTERNAL_REVIEW_SYSTEM_PROMPT =
  'Hidden system instruction for proactive planning. This is an internal review, not a user request. Check today\'s calendar, current weather, system health, and relevant memory together. Avoid spam. Only call send_system_notification when there is a meaningful contextual correlation (e.g., "It will rain during your bike trip" or "Your disk is almost full") that is specific, actionable, and not a duplicate of a recent proactive alert. Otherwise finish without notifying.'

const DAILY_DIGEST_PROMPT =
  'Daily briefing: Summarize what matters for today in a compact, skimmable format. Use read-only tools only (calendar list/read, reminders list, memory recall, current time/weather if helpful). Do not delete, move, or modify files. Do not send email or messages. End with a short "Suggested focus" line. If there is nothing notable, say so briefly.'

const DAILY_DIGEST_SYSTEM_PROMPT =
  'Scheduler digest. Read-only tools only. No destructive or irreversible actions. Prefer calendar_list_events, reminders_list_items, recall_facts/search_vector_memory, get_current_time, get_current_weather. Keep the reply under ~900 words, plain text, bullet lists welcome.'

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) {
    return 8
  }

  const h = Math.floor(hour)
  if (h < 0) {
    return 0
  }

  if (h > 23) {
    return 23
  }

  return h
}

export function createProactiveScheduler(taskQueue: TaskQueue, onReviewComplete?: () => void) {
  let lastMorningReviewKey = ''
  let lastDigestKey = ''
  let inFlight = false
  let digestInFlight = false

  const runReview = async (reason: 'interval' | 'morning') => {
    if (inFlight) {
      return
    }
    inFlight = true
    try {
      const result = await taskQueue.safeEnqueue({
        id: `proactive-review-${reason}-${Date.now()}`,
        source: 'scheduler',
        sourceId: 'proactive-review',
        prompt: INTERNAL_REVIEW_PROMPT,
        supplementalSystemPrompt: INTERNAL_REVIEW_SYSTEM_PROMPT,
        trackProactiveNotifications: true,
        metadata: { reason },
        timeoutMs: 90_000,
      })
      logger.chat('assistant', `[Proactive Review] ${result.response}`)
      onReviewComplete?.()
    } finally {
      inFlight = false
    }
  }

  const runDailyDigest = async () => {
    if (!config.scheduler.dailyDigestEnabled) {
      return
    }

    if (digestInFlight) {
      return
    }

    digestInFlight = true
    try {
      const result = await taskQueue.safeEnqueue({
        id: `daily-digest-${Date.now()}`,
        source: 'scheduler',
        sourceId: 'daily-digest',
        prompt: DAILY_DIGEST_PROMPT,
        supplementalSystemPrompt: DAILY_DIGEST_SYSTEM_PROMPT,
        metadata: { reason: 'daily-digest' },
        timeoutMs: 120_000,
      })

      logger.chat('assistant', `[Daily digest] ${result.response}`)

      if (config.scheduler.dailyDigestTelegram) {
        if (!config.gateways.telegram.botToken?.trim() || !config.gateways.telegram.chatId?.trim()) {
          logger.warn(
            '[Daily digest] APEX_DAILY_DIGEST_TELEGRAM is on but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set.',
          )
          return
        }

        try {
          await sendTelegramPlainMessage(result.response)
        } catch (error: any) {
          logger.warn(`[Daily digest] Telegram send failed: ${error?.message ?? String(error)}`)
        }
      }

      onReviewComplete?.()
    } finally {
      digestInFlight = false
    }
  }

  // Avoid polling cascades: schedule the next interval only after the previous run completes.
  let intervalTimer: NodeJS.Timeout | null = null
  let morningTimer: NodeJS.Timeout | null = null
  let digestTimer: NodeJS.Timeout | null = null

  const scheduleInterval = () => {
    intervalTimer = setTimeout(async () => {
      await runReview('interval')
      scheduleInterval()
    }, config.scheduler.proactiveReviewIntervalMs)
    ;(intervalTimer as any).unref?.()
  }

  const scheduleMorning = () => {
    morningTimer = setTimeout(async () => {
      const now = new Date()
      const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
      if (now.getHours() === config.scheduler.morningReviewHour && lastMorningReviewKey !== currentKey) {
        lastMorningReviewKey = currentKey
        await runReview('morning')
      }
      scheduleMorning()
    }, 60 * 1000)
    ;(morningTimer as any).unref?.()
  }

  const scheduleDigest = () => {
    digestTimer = setTimeout(async () => {
      const now = new Date()
      const hour = clampHour(config.scheduler.dailyDigestHour)
      const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
      if (config.scheduler.dailyDigestEnabled && now.getHours() === hour && lastDigestKey !== currentKey) {
        lastDigestKey = currentKey
        await runDailyDigest()
      }
      scheduleDigest()
    }, 60 * 1000)
    ;(digestTimer as any).unref?.()
  }

  return {
    start() {
      const now = new Date()
      const currentKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
      if (now.getHours() === config.scheduler.morningReviewHour) {
        lastMorningReviewKey = currentKey
        void runReview('morning')
      }

      const digestHour = clampHour(config.scheduler.dailyDigestHour)
      if (
        config.scheduler.dailyDigestEnabled &&
        now.getHours() === digestHour &&
        lastDigestKey !== currentKey
      ) {
        lastDigestKey = currentKey
        void runDailyDigest()
      }

      scheduleInterval()
      scheduleMorning()
      scheduleDigest()
    },
    stop() {
      if (intervalTimer) clearTimeout(intervalTimer)
      if (morningTimer) clearTimeout(morningTimer)
      if (digestTimer) clearTimeout(digestTimer)
    },
  }
}
