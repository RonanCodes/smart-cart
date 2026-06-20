/**
 * Server-only batch resolver: shopping-list names -> store products via the cheap
 * embedding tier (ADR-0004). Lives in its own module (NOT match-server.ts, which
 * a client component imports for the admin scenario server fn) so its server-only
 * dynamic imports never leak into the client bundle. Imported lazily by
 * cart-links-server.ts.
 */

import type { IngredientMatch } from './types'

function noMatch(store: string): IngredientMatch {
  return {
    store,
    product: null,
    priceCents: null,
    confidence: 'none',
    estimated: true,
    score: 0,
  }
}

/**
 * Resolve names to products for one store with the CHEAP tier: embed every name
 * in one call, cosine top-1, no LLM. Used by the bulk cart-link build (a single
 * user tap over the whole list), so per-line LLM reranks are not worth the
 * latency. Honours the ADR-0004 keyless contract: with no key it returns honest
 * no-matches rather than falling back to the old token matcher.
 */
export async function resolveLinesForStore(
  names: ReadonlyArray<string>,
  store: string,
): Promise<Array<{ name: string; match: IngredientMatch }>> {
  const { embeddingKeyPresent, embedQueries } =
    await import('../embeddings/embed')
  if (names.length === 0 || !embeddingKeyPresent()) {
    return names.map((name) => ({ name, match: noMatch(store) }))
  }
  const { getProductVectorsForStore } = await import('../embeddings/store')
  const { getCatalogue } = await import('./catalogue')
  const { storeProductId } = await import('./store-product-rows')
  const { selectCandidates, cheapMatch } = await import('./match-semantic')

  const entries = await getProductVectorsForStore(store)
  const catalogue = getCatalogue(store)
  const lookup = new Map(
    (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
  )
  const vectors = await embedQueries(names)
  return names.map((name, i) => {
    const vec = vectors[i]
    if (!vec) return { name, match: noMatch(store) }
    const cands = selectCandidates(vec, entries, lookup, 1)
    return { name, match: cheapMatch(store, cands) }
  })
}
