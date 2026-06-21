import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Recipe media cache (SQLite / D1). One row per recipe, holding the generated
 * cooking-video URL (Pixverse) and the "Souso knows" health/food blurb. The
 * point of this table is simple: never redo an external API call. A button in
 * the admin recipe inspector generates each artefact once; every load after
 * reads the cached value here and spends nothing.
 *
 * Standalone table, deliberately NOT part of src/db/schema.ts so it ships as its
 * own hand-authored migration without regenerating the household migration (the
 * recipe_embedding / store_product / recipe_facts pattern; drizzle-kit only sees
 * schema.ts). ADR-0004.
 */
export const recipeMedia = sqliteTable('recipe_media', {
  /** The recipe id this media belongs to (matches recipe.id). One row per recipe. */
  recipeId: text('recipe_id').primaryKey(),
  /** The generated MP4 URL from Pixverse. Null until a video is generated. */
  videoUrl: text('video_url'),
  /** Last known Pixverse status (e.g. 'done', 'failed'), for surfacing in admin. */
  videoStatus: text('video_status'),
  /** The cooking prompt sent to Pixverse, kept for inspection. */
  videoPrompt: text('video_prompt'),
  /** When the video URL was cached. */
  videoAt: integer('video_at', { mode: 'timestamp' }),
  /** The "Souso knows" payload (JSON-as-text: { content, sources, source }). */
  sousoKnows: text('souso_knows'),
  /** When the Souso knows blurb was cached. */
  sousoKnowsAt: integer('souso_knows_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type RecipeMediaRow = typeof recipeMedia.$inferSelect
