/**
 * Server-only batch resolvers: shopping-list names -> store products (ADR-0004).
 * Lives in its own module (NOT match-server.ts, which a client component imports
 * for the admin scenario server fn) so its server-only dynamic imports never leak
 * into the client bundle. Imported lazily by cart-links-server.ts and
 * price-compare-server.ts.
 *
 * Resolve lines by trying raw embedding retrieval first. If the top product is
 * strong and clearly separated, accept it immediately. Otherwise expand to Dutch
 * search terms, retrieve cosine candidates, then ask the reranker to pick the SKU
 * or decline.
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

/** A cart line to resolve: the list name plus its exact amount string. */
export interface CartLineToResolve {
  name: string
  amount?: string | null
}

/**
 * Resolve cart lines for one store with the accurate ADR-0004 path. The amount
 * is passed to the rerank as qty/unit so it size-matches the pack. Any per-line
 * failure degrades to a no-match, so a model hiccup never inserts an unvalidated
 * product. With no key: honest no-matches.
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
  const { embeddingOnlyMatch, selectCandidatesFromQueries, rerankMatch } =
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

  const out = lines.map((line) => ({ name: line.name, match: noMatch(store) }))

  let rawVectors: Array<ReadonlyArray<number>>
  try {
    rawVectors = await embedQueries(lines.map((line) => line.name))
  } catch {
    return out
  }

  const pending: Array<{
    index: number
    rawCandidates: ReturnType<typeof selectCandidatesFromQueries>
  }> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const rawVector = rawVectors[i]
    if (!rawVector) continue

    const rawCandidates = selectCandidatesFromQueries(
      [rawVector],
      entries,
      lookup,
      10,
    )
    const direct = embeddingOnlyMatch(rawCandidates, store)
    if (direct) out[i] = { name: line.name, match: direct }
    else pending.push({ index: i, rawCandidates })
  }

  const expanded = await Promise.all(
    pending.map(async (p) => {
      const line = lines[p.index]!
      try {
        const { terms } = await expandIngredientSearchTerms(
          line.name,
          expandDeps,
        )
        const rawTerm = line.name.trim().toLowerCase()
        return {
          ...p,
          expandedTerms: terms.filter(
            (term) => term.trim().toLowerCase() !== rawTerm,
          ),
        }
      } catch {
        return { ...p, expandedTerms: [] }
      }
    }),
  )

  const expandedTermSlots: Array<{ pendingIndex: number; term: string }> = []
  expanded.forEach((p, pendingIndex) => {
    for (const term of p.expandedTerms) {
      expandedTermSlots.push({ pendingIndex, term })
    }
  })

  let expandedVectors: Array<ReadonlyArray<number>> = []
  if (expandedTermSlots.length > 0) {
    try {
      expandedVectors = await embedQueries(expandedTermSlots.map((s) => s.term))
    } catch {
      expandedVectors = []
    }
  }

  const vectorsByPending = new Map<number, Array<ReadonlyArray<number>>>()
  expandedTermSlots.forEach((slot, i) => {
    const vector = expandedVectors[i]
    if (!vector) return
    const vectors = vectorsByPending.get(slot.pendingIndex) ?? []
    vectors.push(vector)
    vectorsByPending.set(slot.pendingIndex, vectors)
  })

  await Promise.all(
    expanded.map(async (p, pendingIndex) => {
      const line = lines[p.index]!
      const rawVector = rawVectors[p.index]
      if (!rawVector) return
      try {
        const extraVectors = vectorsByPending.get(pendingIndex) ?? []
        const candidates = extraVectors.length
          ? selectCandidatesFromQueries(
              [rawVector, ...extraVectors],
              entries,
              lookup,
              10,
            )
          : p.rawCandidates
        const { qty, unit } = splitAmount(line.amount)
        const { match } = await rerankMatch(
          { name: line.name, qty, unit },
          candidates,
          store,
          rerankDeps,
        )
        out[p.index] = { name: line.name, match }
      } catch {
        out[p.index] = { name: line.name, match: noMatch(store) }
      }
    }),
  )

  return out
}
