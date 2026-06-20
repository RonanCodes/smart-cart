import { createServerFn } from '@tanstack/react-start'

/**
 * Server seam for the embedding ingredient -> SKU matcher (ADR-0004). Wires the
 * pure matcher (match-semantic.ts) to the live bindings: embeds the ingredient
 * (OpenAI), loads the store's product vectors from D1, and runs BOTH tiers so the
 * admin Matching view can show the cheap cosine top-1 next to the LLM rerank for
 * the same ingredient. Server-only: every server import is lazy so none of it
 * reaches the client bundle (the admin-server / replan-server pattern).
 *
 * This is also the entry the cart path will call (rerank tier) once price-list is
 * moved onto it; for now it powers the scenario runner that proves match quality.
 */

export interface MatchHit {
  name: string | null
  slug: string | null
  priceCents: number | null
  confidence: string
  score: number
  estimated: boolean
}

export interface MatchScenarioResult {
  ingredient: string
  store: string
  /** False when no OPENAI_API_KEY: the runner cannot embed the query, so empty. */
  keyPresent: boolean
  /** The retrieved candidates (cosine top-K), nearest first. */
  candidates: Array<{ name: string; priceCents: number; score: number }>
  /** Cheap tier: cosine top-1, confidence from the score. No LLM. */
  cheap: MatchHit
  /** Accurate tier: the LLM-reranked pick. Null when there was nothing to rerank. */
  reranked: MatchHit | null
}

const EMPTY_HIT: MatchHit = {
  name: null,
  slug: null,
  priceCents: null,
  confidence: 'none',
  score: 0,
  estimated: true,
}

export const runMatchScenario = createServerFn({ method: 'POST' })
  .validator((d: { ingredient: string; store?: string }) => d)
  .handler(async ({ data }): Promise<MatchScenarioResult> => {
    const { isAdmin } = await import('../admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')

    const store = (data.store ?? 'ah').toLowerCase()
    const ingredient = data.ingredient.trim()

    const { embeddingKeyPresent, embedQuery } =
      await import('../embeddings/embed')
    const keyPresent = embeddingKeyPresent()
    if (!ingredient || !keyPresent) {
      return {
        ingredient,
        store,
        keyPresent,
        candidates: [],
        cheap: EMPTY_HIT,
        reranked: null,
      }
    }

    const { getProductVectorsForStore } = await import('../embeddings/store')
    const { getCatalogue } = await import('./catalogue')
    const { storeProductId } = await import('./store-product-rows')
    const { selectCandidates, cheapMatch, rerankMatch } =
      await import('./match-semantic')
    const { models } = await import('../models')

    const vec = await embedQuery(ingredient)
    const entries = await getProductVectorsForStore(store)
    const catalogue = getCatalogue(store)
    const lookup = new Map(
      (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
    )
    const candidates = selectCandidates(vec, entries, lookup, 10)

    const cheap = cheapMatch(store, candidates)
    const reranked = await rerankMatch(
      { name: ingredient },
      candidates,
      store,
      {
        model: models.fast,
      },
    )

    const toHit = (m: typeof cheap): MatchHit => ({
      name: m.product?.name ?? null,
      slug: m.product?.slug ?? null,
      priceCents: m.priceCents,
      confidence: m.confidence,
      score: m.score,
      estimated: m.estimated,
    })

    return {
      ingredient,
      store,
      keyPresent,
      candidates: candidates.map((c) => ({
        name: c.product.name,
        priceCents: c.product.priceCents,
        score: c.score,
      })),
      cheap: toHit(cheap),
      reranked: candidates.length ? toHit(reranked) : null,
    }
  })
