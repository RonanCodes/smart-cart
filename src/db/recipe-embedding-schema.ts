import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Recipe embeddings (SQLite / D1). One row per recipe, holding the base64 Float32
 * vector built offline (scripts/embed-catalogue.ts) and loaded by `pnpm seed`.
 * Standalone table, deliberately NOT part of src/db/schema.ts so it ships as its
 * own migration without regenerating the household migration (the store_product /
 * staples pattern). ADR-0004.
 *
 * Vectors live IN D1 (no Vectorize, no Turso): at this catalogue size a brute-force
 * cosine over the loaded set is sub-5ms, and committing the vectors means a fresh
 * clone / CI run with no API calls. `model` + `dims` record what the vector was
 * built with so a stale index fails loud (see manifest.ts).
 */
export const recipeEmbedding = sqliteTable('recipe_embedding', {
  /** The recipe id this vector belongs to (matches recipe.id). */
  recipeId: text('recipe_id').primaryKey(),
  /** Base64-encoded Float32 vector. */
  embedding: text('embedding').notNull(),
  /** The embedding model the vector was built with (e.g. text-embedding-3-small). */
  model: text('model').notNull(),
  /** The vector dimensions (e.g. 256). */
  dims: integer('dims').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type RecipeEmbeddingRow = typeof recipeEmbedding.$inferSelect
