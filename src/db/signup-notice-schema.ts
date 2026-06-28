import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Claim-once log for the admin "new signup" email (SQLite / D1). One row per
 * user means "the admin notice for this signup has been sent", so the email
 * fires EXACTLY ONCE no matter how many code paths try to send it.
 *
 * Why: the new-user admin notice can be triggered from two places — Better
 * Auth's `user.create.after` hook (fires at account creation, before we know the
 * attribution) and `completeOnboarding` (fires right after, WITH the
 * "How did you find us?" attribution). We want the attributed send to win, so
 * the onboarding flow CLAIMS this row first (inside completeOnboarding, after
 * the account exists) and sends the attributed email; the hook only sends if the
 * claim is still free (the genuine non-onboarding edge: an approved first-time
 * email signing in directly, which never runs completeOnboarding). The UNIQUE
 * userId + INSERT-or-skip makes the claim atomic, so there are no duplicates.
 *
 * Standalone, hand-authored migration (the app-feedback / waitlist pattern).
 */
export const signupNotice = sqliteTable('signup_notice', {
  /** The user whose signup notice has been claimed/sent. PRIMARY KEY = at most
   * one notice per user, the dedup guarantee. */
  userId: text('user_id').primaryKey(),
  notifiedAt: integer('notified_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type SignupNoticeRow = typeof signupNotice.$inferSelect
