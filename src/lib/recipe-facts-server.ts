import { createServerFn } from '@tanstack/react-start'
import type { RecipeFactsInput, RecipeFactsResult } from './recipe-facts-core'

// Re-export the types so a component can import them from the server-fn module
// without reaching into recipe-facts-core (which is server-only: it dynamic-
// imports db/client and would leak `cloudflare:workers` into the client bundle).
// These are type-only re-exports, erased at build time.
export type { RecipeFactsInput, RecipeFactsResult } from './recipe-facts-core'

/**
 * The "Souso knows" facts for a recipe, source-cited via Cala (cala.ai). A thin
 * server-fn wrapper: the createServerFn body is stripped from the client bundle,
 * and the real logic lives in recipe-facts-core (dynamically imported here, never
 * statically) so nothing server-only (db, env, the key) leaks to the browser.
 * Mirrors the similar-server / replan-server pattern.
 */
export const getRecipeFacts = createServerFn({ method: 'POST' })
  .inputValidator((d: RecipeFactsInput) => d)
  .handler(async ({ data }): Promise<RecipeFactsResult> => {
    const { fetchRecipeFacts } = await import('./recipe-facts-core')
    return fetchRecipeFacts(data)
  })
