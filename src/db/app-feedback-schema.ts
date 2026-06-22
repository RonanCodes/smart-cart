import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

/**
 * General in-app feedback (SQLite / D1). Standalone table, deliberately NOT part
 * of the main profile schema (src/db/schema.ts) so it ships without regenerating
 * the household migration (the waitlist-schema / staples-schema / match-cache
 * pattern: hand-authored SQL migration + journal entry).
 *
 * Why a NEW table rather than reusing `meal_feedback`: `meal_feedback` is a
 * recipe-scoped taste signal (thumbs up/down on a planned dinner) that the
 * recommender folds into the household's next week. General feedback ("the swap
 * button is hard to find", "love the app") is a free-text message to the team,
 * not a planner signal, and often has no recipe at all. It needs its own store so
 * the admin can read it as an inbox without polluting the taste model.
 *
 * `userId` / `email` are nullable so a signed-out visitor (or one whose session
 * resolves to no email) can still send feedback; the contact-email fallback in
 * the form covers the case where they would rather mail us directly.
 */
export const appFeedback = sqliteTable(
  'app_feedback',
  {
    id: text('id').primaryKey(),
    /** The signed-in user who sent it, when known (null for guests). */
    userId: text('user_id'),
    /** A contact email the sender optionally left (or their session email). */
    email: text('email'),
    /** An optional phone / WhatsApp number so the team can reach out for a chat. */
    phone: text('phone'),
    /** The free-text feedback message. Always present (empty is rejected). */
    message: text('message').notNull(),
    /**
     * Which surface they sent it from, for triage: 'tab-bar' (the bottom FAB),
     * 'sign-in' (the blocked-at-login trigger), or 'settings'. The app always
     * writes an explicit source, so the column default is never hit on insert;
     * it is kept only as the historical literal ('bubble') so no migration is
     * needed to change a default that has no runtime effect.
     */
    source: text('source').notNull().default('bubble'),
    /** The route path they were on when they sent it, for context. */
    path: text('path'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => ({
    createdAtIdx: index('app_feedback_created_at_idx').on(t.createdAt),
  }),
)

export type AppFeedbackRow = typeof appFeedback.$inferSelect
