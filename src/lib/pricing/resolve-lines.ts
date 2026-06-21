/**
 * Server-only batch resolvers: shopping-list names -> store products (ADR-0004).
 * Lives in its own module (NOT match-server.ts, which a client component imports
 * for the admin scenario server fn) so its server-only dynamic imports never leak
 * into the client bundle. Imported lazily by cart-links-server.ts and
 * price-compare-server.ts.
 *
 * Two resolvers, matching the two ADR-0004 tiers:
 *
 *  - resolveLinesForStore (CHEAP): embed every name in one call, cosine top-1, no
 *    LLM. Used by the price-comparison total, which runs for EVERY covered store
 *    on every list change; a per-line LLM there would be ~2x the line count in
 *    model calls per refresh. Confidence comes from the cosine score.
 *
 *  - resolveLinesForStoreAccurate (ACCURATE): the AH/Jumbo CART path, where we
 *    build the real basket and a wrong pick costs the user money. Per line:
 *    expand to Dutch search terms, union the top-K across terms, then LLM-rerank
 *    to pick the right SKU + reject type mismatches (Doritos for "chilli flakes",
 *    a cake for "almond flour", a ready-meal for "'nduja"). This is the tier the
 *    ADR always specified for the cart; the cart used to call the cheap tier,
 *    which is why basic ingredients matched snacks/cakes/ready-meals.
 *
 * Both honour the ADR-0004 keyless contract: with no key they return honest
 * no-matches rather than falling back to the old token matcher.
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
 * Split a shopping-list amount string ('150 g', "1.5 tenen", '2 stuks') into a
 * leading quantity + trailing unit, so the rerank can size-match the pack
 * (150 g -> a ~500 g pack, not a 2 kg bag). Returns nulls when there is no
 * numeric head (e.g. 'a pinch'). Pure + local: the basket builder has its own
 * dimension parser; this one only feeds the LLM prompt, so it stays loose.
 */
export function splitAmount(amount: string | null | undefined): {
  qty: string | null
  unit: string | null
} {
  const s = (amount ?? '').trim()
  if (!s) return { qty: null, unit: null }
  const m = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*(.*)$/.exec(s)
  if (!m) return { qty: null, unit: s }
  const qty = (m[1] ?? '').trim() || null
  const unit = (m[2] ?? '').trim() || null
  return { qty, unit }
}

/**
 * Resolve names to products for one store with the CHEAP tier: embed every name
 * in one call, cosine top-1, no LLM. Used by the price-comparison total (a
 * cross-store call on every list change), so per-line LLM reranks are not worth
 * the latency. Honours the ADR-0004 keyless contract: with no key it returns
 * honest no-matches rather than falling back to the old token matcher.
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
    // Pull a few candidates (not just top-1) so the type-mismatch guard in
    // cheapMatch can skip a junk nearest neighbour and fall to the next real one.
    const cands = selectCandidates(vec, entries, lookup, 5)
    return { name, match: cheapMatch(store, cands, name) }
  })
}

/** A cart line to resolve: the list name plus its exact amount string. */
export interface CartLineToResolve {
  name: string
  amount?: string | null
}

/**
 * Resolve cart lines for one store with the ACCURATE tier (ADR-0004): per line,
 * expand to Dutch search terms, union the cosine top-K across those terms, then
 * LLM-rerank to pick the right SKU (and decline a type mismatch). The amount is
 * passed to the rerank as qty/unit so it size-matches the pack.
 *
 * Bounded by design: this runs ONLY on the cart build (one user tap), never on
 * the price-comparison refresh. Lines are reranked concurrently. Any per-line
 * failure degrades to that line's cheap top-1 (rerankMatch already does this),
 * so a model hiccup never empties the cart. With no key: honest no-matches.
 */
export async function resolveLinesForStoreAccurate(
  lines: ReadonlyArray<CartLineToResolve>,
  store: string,
): Promise<Array<{ name: string; match: IngredientMatch }>> {
  const { embeddingKeyPresent } = await import('../embeddings/embed')
  if (lines.length === 0 || !embeddingKeyPresent()) {
    return lines.map((l) => ({ name: l.name, match: noMatch(store) }))
  }

  const { getProductVectorsForStore } = await import('../embeddings/store')
  const { getCatalogue } = await import('./catalogue')
  const { storeProductId } = await import('./store-product-rows')
  const { selectCandidatesFromQueries, rerankMatch } =
    await import('./match-semantic')
  const { expandIngredientSearchTerms } = await import('./expand-ingredient')
  const { embedQueries } = await import('../embeddings/embed')
  const { models } = await import('../models')
  const { generateObject } = await import('../braintrust-ai')

  const entries = await getProductVectorsForStore(store)
  const catalogue = getCatalogue(store)
  const lookup = new Map(
    (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
  )

  const rerankDeps = { model: models.rerank, generateObject }
  const expandDeps = { model: models.rerank, generateObject }

  return Promise.all(
    lines.map(async (line) => {
      try {
        const { terms } = await expandIngredientSearchTerms(
          line.name,
          expandDeps,
        )
        const vectors = await embedQueries(terms)
        const candidates = selectCandidatesFromQueries(
          vectors,
          entries,
          lookup,
          10,
        )
        const { qty, unit } = splitAmount(line.amount)
        const { match } = await rerankMatch(
          { name: line.name, qty, unit },
          candidates,
          store,
          rerankDeps,
        )
        return { name: line.name, match }
      } catch {
        // Never empty the cart on a single bad line: report it as no-match.
        return { name: line.name, match: noMatch(store) }
      }
    }),
  )
}
