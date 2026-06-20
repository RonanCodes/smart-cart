import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Web Push subscriptions (SQLite / D1). Standalone table, NOT part of the main
 * profile schema (src/db/schema.ts), matching the waitlist / access-grant /
 * staples pattern so it ships on its own hand-written migration (0007).
 *
 * Why this exists: to send a PWA push notification (e.g. "How was tonight's
 * dinner? Tap to rate.") the Worker needs the browser's PushSubscription. The
 * browser hands us an `endpoint` (the push service URL, unique per device +
 * subscription) plus two keys, `p256dh` (the client public key) and `auth` (a
 * shared secret), which together let the server encrypt a payload only that
 * browser can read. We store one row per endpoint; re-subscribing the same
 * browser upserts on the unique endpoint rather than stacking duplicates.
 *
 * `householdId` is the signed-in household the subscription belongs to, so the
 * admin can target "send to this user" by joining household -> subscription.
 */
export const pushSubscription = sqliteTable('push_subscription', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull(),
  /** The push-service URL. Unique per browser subscription (the dedupe key). */
  endpoint: text('endpoint').notNull().unique(),
  /** Client public key (base64url) used to encrypt the payload. */
  p256dh: text('p256dh').notNull(),
  /** Shared auth secret (base64url). */
  auth: text('auth').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type PushSubscriptionRow = typeof pushSubscription.$inferSelect
