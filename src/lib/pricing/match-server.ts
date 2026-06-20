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
  /** Set when the accurate tier LLM ran; absent on cosine fallback. */
  reason?: string | null
  /** True when the LLM declined all candidates (not a transport error). */
  declined?: boolean
  /** True when the accurate tier fell back to cosine (model error / no key). */
  llmFallback?: boolean
  /** Search terms embedded for retrieval (original + Dutch expansion). */
  searchTerms?: Array<string>
}

export interface MatchScenarioResult {
  ingredient: string
  store: string
  /** False when no OPENAI_API_KEY: the runner cannot embed the query, so empty. */
  keyPresent: boolean
  /** The retrieved candidates (cosine top-K), nearest first. */
  candidates: Array<{
    productId: string
    name: string
    size: string | null
    priceCents: number
    score: number
  }>
  /** Cheap tier: cosine top-1, confidence from the score. No LLM. */
  cheap: MatchHit
  /** Accurate tier: the LLM-reranked pick. Null when there was nothing to rerank. */
  reranked: MatchHit | null
  /** Terms embedded for cosine retrieval (shown in admin for debugging). */
  searchTerms: Array<string>
  /** True when Dutch term expansion fell back to the raw ingredient only. */
  expandFallback?: boolean
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

    const { embeddingKeyPresent } = await import('../embeddings/embed')
    const keyPresent = embeddingKeyPresent()
    if (!ingredient || !keyPresent) {
      return {
        ingredient,
        store,
        keyPresent,
        candidates: [],
        cheap: EMPTY_HIT,
        reranked: null,
        searchTerms: [],
      }
    }

    const { getProductVectorsForStore } = await import('../embeddings/store')
    const { getCatalogue } = await import('./catalogue')
    const { storeProductId } = await import('./store-product-rows')
    const { selectCandidatesFromQueries, cheapMatch, rerankMatch } =
      await import('./match-semantic')
    const { candidateId } = await import('./rerank-sku')
    const { expandIngredientSearchTerms } = await import('./expand-ingredient')
    const { models } = await import('../models')
    const { EMBEDDING_DIMENSIONS } = await import('../embeddings/manifest')
    const { generateObject, embedMany, traced, flush } =
      await import('../braintrust-ai')

    const embeddingProviderOptions = {
      openai: { dimensions: EMBEDDING_DIMENSIONS },
    }

    return traced(
      async () => {
        try {
          const { terms: searchTerms, expandFallback } =
            await expandIngredientSearchTerms(ingredient, {
              model: models.rerank,
              generateObject,
            })
          const { embeddings: vectors } = await embedMany({
            model: models.embedding,
            values: [...searchTerms],
            providerOptions: embeddingProviderOptions,
            span_info: {
              name: 'embed-search-terms',
              metadata: { ingredient, terms: searchTerms },
            },
          })
          const entries = await getProductVectorsForStore(store)
          const catalogue = getCatalogue(store)
          const lookup = new Map(
            (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
          )
          const candidates = selectCandidatesFromQueries(
            vectors,
            entries,
            lookup,
            10,
          )

          const cheap = cheapMatch(store, candidates)
          const {
            match: reranked,
            reason: rerankReason,
            declined: rerankDeclined,
            llmFallback: rerankFallback,
          } = await rerankMatch({ name: ingredient }, candidates, store, {
            model: models.rerank,
            generateObject,
          })

          const toHit = (
            m: typeof cheap,
            opts?: {
              reason?: string | null
              declined?: boolean
              llmFallback?: boolean
            },
          ): MatchHit => ({
            name: m.product?.name ?? null,
            slug: m.product?.slug ?? null,
            priceCents: m.priceCents,
            confidence: m.confidence,
            score: m.score,
            estimated: m.estimated,
            reason: opts?.reason ?? null,
            declined: opts?.declined,
            llmFallback: opts?.llmFallback,
          })

          return {
            ingredient,
            store,
            keyPresent,
            searchTerms,
            expandFallback,
            candidates: candidates.map((c) => ({
              productId: candidateId(c.product),
              name: c.product.name,
              size: c.product.size.raw.trim() || null,
              priceCents: c.product.priceCents,
              score: c.score,
            })),
            cheap: toHit(cheap),
            reranked: candidates.length
              ? toHit(reranked, {
                  reason: rerankReason,
                  declined: rerankDeclined,
                  llmFallback: rerankFallback,
                })
              : null,
          }
        } finally {
          await flush()
        }
      },
      { name: 'ingredient-sku-match', type: 'task' },
    )
  })
