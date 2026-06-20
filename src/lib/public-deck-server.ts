import { createServerFn } from '@tanstack/react-start'
import type { DeckCard } from './recsys-data'

interface SwipeInput {
  recipeId: string
  like: boolean
}

/**
 * Public swipe deck — no auth, no household required.
 *
 * This is the anonymous opener's data source: a not-signed-in visitor lands in
 * the swipe deck and pulls batches from here. It reuses the same imaged-only
 * catalogue and adaptive recommender as the authed onboarding deck, so an
 * anonymous run feels identical to the signed-in one; the only difference is
 * there is no session and nothing is persisted server-side. The held swipes are
 * passed back up each call so the recommender keeps adapting client-side.
 */
export const getPublicDeck = createServerFn({ method: 'POST' })
  .inputValidator((d: { swipes: Array<SwipeInput>; k?: number }) => d)
  .handler(async ({ data }): Promise<Array<DeckCard>> => {
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { recipes, cards } = await loadCatalogue()
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)
    const deck = rec.nextDeck(data.swipes, data.k ?? 8)
    return deck.flatMap((r) => {
      const c = cards.get(r.id)
      return c ? [c] : []
    })
  })
