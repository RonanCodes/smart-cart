import { createServerFn } from '@tanstack/react-start'
import type { DiscoverCard } from './discover-core'

// Re-export the card type so a component can import it from the server-fn module
// without reaching into discover-core (which is server-only: it dynamic-imports
// db/client and would leak `cloudflare:workers` into the client bundle). This is
// a type-only re-export, erased at build time.
export type { DiscoverCard } from './discover-core'

/**
 * The personalized Discover feed for the signed-in household, source-cited via
 * Cala (cala.ai). A thin server-fn wrapper: the createServerFn body is stripped
 * from the client bundle, and the real logic lives in discover-core (dynamically
 * imported here, never statically) so nothing server-only (db, env, the key)
 * leaks to the browser. Mirrors the recipe-facts-server pattern.
 *
 * Cache-first within a 24h TTL; returns `[]` when the key is unconfigured or the
 * user isn't onboarded, so the feed hides cleanly.
 */
export const getDiscoverCards = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Array<DiscoverCard>> => {
    const { fetchDiscoverCards } = await import('./discover-core')
    return fetchDiscoverCards({})
  },
)

/**
 * Force-regenerate the feed (the "Refresh ideas" affordance), ignoring a fresh
 * cache row and spending Cala credits to rebuild. Returns the new cards.
 */
export const refreshDiscoverCards = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Array<DiscoverCard>> => {
    const { fetchDiscoverCards } = await import('./discover-core')
    return fetchDiscoverCards({ force: true })
  },
)
