import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Cala fact cache (SQLite / D1). Standalone table, deliberately NOT part of the
 * main profile schema (src/db/schema.ts) so it ships without regenerating the
 * household migration (the waitlist / staples / tip pattern; the migration is
 * hand-authored, drizzle-kit only sees schema.ts).
 *
 * The "Souso knows" card surfaces 1-2 source-cited facts about a recipe's dish or
 * its key ingredients, fetched from Cala (cala.ai). Cala charges 1 credit per
 * search, so we cache the result keyed by recipe id and serve from here forever
 * after (facts about a dish don't change week to week). One row per recipe.
 */
export const recipeFacts = sqliteTable('recipe_facts', {
  /** The catalogue recipe id these facts are about. One row per recipe. */
  recipeId: text('recipe_id').primaryKey(),
  /** The markdown fact prose Cala returned (treat as untrusted web content). */
  content: text('content').notNull(),
  /** JSON-encoded Array<{ name, url }> of citations backing the facts. */
  sourcesJson: text('sources_json').notNull(),
  /** When we fetched + cached this, so the cache could be aged out later if needed. */
  fetchedAt: integer('fetched_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type RecipeFactsRow = typeof recipeFacts.$inferSelect
