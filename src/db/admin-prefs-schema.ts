import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Per-admin notification preferences (SQLite / D1). Standalone table, NOT part
 * of the main profile schema (src/db/schema.ts), matching the waitlist + staples
 * pattern so it ships on its own hand-written migration.
 *
 * Default-on semantics: admins receive waitlist-signup emails by default, so a
 * row only EXISTS to record a deviation (an opt-out, or a later re-opt-in). An
 * admin with NO row is treated as enabled. `email` is the trim+lowercase
 * normalised admin email (the same normalisation as access-rules).
 */
export const adminNotificationPref = sqliteTable('admin_notification_pref', {
  email: text('email').primaryKey(),
  waitlistNotify: integer('waitlist_notify', { mode: 'boolean' })
    .notNull()
    .default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type AdminNotificationPrefRow = typeof adminNotificationPref.$inferSelect
