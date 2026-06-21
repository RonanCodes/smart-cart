import { createServerFn } from '@tanstack/react-start'
import type {
  RecipeDetailInput,
  RecipeDetailResult,
} from './recipe-detail-core'

// Re-export the types so a component can import them from the server-fn module
// without reaching into recipe-detail-core (which is server-only: it dynamic-
// imports db/client and would leak `cloudflare:workers` into the client bundle).
// These are type-only re-exports, erased at build time.
export type {
  RecipeDetailInput,
  RecipeDetailResult,
  RecipeIngredient,
} from './recipe-detail-core'

/**
 * The recipe detail (ingredients + written-out steps) for one catalogue recipe.
 * A thin server-fn wrapper: the createServerFn body is stripped from the client
 * bundle, and the real logic lives in recipe-detail-core (dynamically imported
 * here, never statically) so nothing server-only (db, auth) leaks to the browser.
 * Mirrors the recipe-facts-server / similar-server pattern.
 */
export const getRecipeDetail = createServerFn({ method: 'POST' })
  .inputValidator((d: RecipeDetailInput) => d)
  .handler(async ({ data }): Promise<RecipeDetailResult> => {
    const { fetchRecipeDetail } = await import('./recipe-detail-core')
    return fetchRecipeDetail(data)
  })
