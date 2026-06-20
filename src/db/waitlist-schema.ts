import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Waitlist (SQLite / D1). Standalone table, deliberately NOT part of the main
 * profile schema (src/db/schema.ts) so it can ship without regenerating the
 * household migration. The marketing landing captures emails here; nothing else
 * reads it yet. One row per email (unique), idempotent on re-submit.
 */
export const waitlist = sqliteTable('waitlist', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type WaitlistRow = typeof waitlist.$inferSelect
