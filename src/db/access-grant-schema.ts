import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * DB-backed access grants (SQLite / D1). Standalone table, NOT part of the main
 * profile schema (src/db/schema.ts), matching the waitlist + staples + admin-pref
 * pattern so it ships on its own hand-written migration.
 *
 * Why this exists: the approved + admin lists were ENV-only secrets
 * (APPROVED_EMAILS / ADMIN_EMAILS) that the running Worker can read but cannot
 * write. A grant row lets the admin console approve a waitlisted person or
 * promote them to admin with NO redeploy. `email` is the trim+lowercase
 * normalised email (the same normalisation as access-rules). `role` is
 * 'user' (login access) or 'admin' (login + admin console); admin implies user.
 */
export const accessGrant = sqliteTable('access_grant', {
  email: text('email').primaryKey(),
  role: text('role', { enum: ['user', 'admin'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type AccessGrantRow = typeof accessGrant.$inferSelect
