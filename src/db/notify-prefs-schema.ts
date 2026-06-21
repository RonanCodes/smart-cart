import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Per-household notification preferences (SQLite / D1). Standalone table, NOT
 * part of the main profile schema (src/db/schema.ts), matching the waitlist /
 * access-grant / staples / admin-notification-pref pattern so it ships on its
 * own hand-written migration.
 *
 * Drives the WEEKLY-PLAN REMINDER push (Part B/C): the household picks a day +
 * time to be nudged to plan next week. The rate-meal push (~20:00 daily) is NOT
 * configured here — it fires at a fixed time for everyone with a subscription.
 *
 * Default-off semantics: a household with NO row is treated as disabled (the
 * reminder is opt-in). A row exists once the user has touched the setting.
 */
export const householdNotifyPref = sqliteTable('household_notify_pref', {
  householdId: text('household_id').primaryKey(),
  /** Whether the weekly-plan reminder is on. Default off (opt-in). */
  planReminderEnabled: integer('plan_reminder_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** Day of week to send: 0 = Sunday .. 6 = Saturday. Default Sunday. */
  planReminderDow: integer('plan_reminder_dow').notNull().default(0),
  /** Local (Europe/Amsterdam) time to send, 'HH:MM' 24h. Default 17:00. */
  planReminderTime: text('plan_reminder_time').notNull().default('17:00'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type HouseholdNotifyPrefRow = typeof householdNotifyPref.$inferSelect

/**
 * Dedupe log for scheduled pushes (Part C). The cron fires every 15 minutes, so
 * a naive "send when the time matches" would re-send within the same matching
 * bucket. We instead record one row per (household, kind, sentKey) and skip a
 * send whose key already exists. `sentKey` is the dedupe scope:
 *   - rate-meal:    the Amsterdam calendar date (YYYY-MM-DD) — once per day.
 *   - plan-reminder: the NEXT week's Monday (YYYY-MM-DD) — once per week.
 */
export const nudgeLog = sqliteTable('nudge_log', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  /** 'rate_meal' | 'plan_reminder'. */
  kind: text('kind').notNull(),
  /** The dedupe scope key (date for rate-meal, next-Monday for plan-reminder). */
  sentKey: text('sent_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type NudgeLogRow = typeof nudgeLog.$inferSelect
