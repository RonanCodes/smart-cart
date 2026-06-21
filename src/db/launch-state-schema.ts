import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * App launch state (SQLite / D1). Standalone table, NOT part of the main profile
 * schema (src/db/schema.ts), matching the waitlist / staples / tip / payment-mode
 * pattern so it ships on its own hand-written migration (drizzle-kit only sees
 * schema.ts).
 *
 * A single `scope='global'` row records whether Souso has gone live. When
 * `launched` is true the sign-in gate (isApproved) opens for everyone and the
 * marketing landing drops the waitlist form. The ABSENCE of the row means "not
 * launched" (waitlist mode), so a fresh DB defaults to gated, never wide open.
 */
export const launchState = sqliteTable('launch_state', {
  /** Always 'global'. A single row holds the app-wide launch flag. */
  scope: text('scope').primaryKey(),
  /** True once the app has gone live (waitlist removed, open sign-in). */
  launched: integer('launched', { mode: 'boolean' }).notNull().default(false),
  /** When the app first went live, for the admin "Live since …" label. */
  launchedAt: integer('launched_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type LaunchStateRow = typeof launchState.$inferSelect
