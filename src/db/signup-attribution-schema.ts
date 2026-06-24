import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Signup attribution (SQLite / D1): how a user found Souso, captured in the
 * onboarding "How did you find us?" step and persisted at onboarding-complete
 * (the `completeOnboarding` server fn, where the account already exists so we
 * have a userId). Standalone table, deliberately NOT part of the main profile
 * schema (src/db/schema.ts) so it ships with a hand-authored migration + journal
 * entry, like waitlist-schema / app-feedback-schema.
 *
 * ABSENCE = UNKNOWN by design. Users who onboarded BEFORE this feature simply
 * have NO row, which reads as "source unknown (joined before we asked)". We do
 * NOT backfill, and there is no pop-up here for pre-existing users — the
 * maintainer will add that separately. The model only needs to make absence
 * meaningful, which a `userId UNIQUE` table with no row per old user already does.
 *
 * The whole step is optional, so every field is nullable: a user can continue
 * without picking a source. `source` is the single-select bucket (linkedin /
 * tiktok / instagram / word_of_mouth / other); `sourceOther` is the free text
 * shown when `source = 'other'`; `referrer` is the always-shown optional
 * "anyone we should thank?" free text (the person who shared it).
 */
export const signupAttribution = sqliteTable('signup_attribution', {
  id: text('id').primaryKey(),
  /** The user this attribution belongs to. UNIQUE so a redo upserts, never
   * duplicates; absence of a row = source unknown (onboarded before we asked). */
  userId: text('user_id').notNull().unique(),
  /** Single-select source bucket: 'linkedin' | 'tiktok' | 'instagram' |
   * 'word_of_mouth' | 'other'. Null when the user skipped the question. */
  source: text('source'),
  /** Free text shown only when source = 'other' ("Where did you find us?"). */
  sourceOther: text('source_other'),
  /** Optional "anyone we should thank?" free text — the person who shared it. */
  referrer: text('referrer'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type SignupAttributionRow = typeof signupAttribution.$inferSelect
