/**
 * Embedding ingredient -> product (SKU) matcher (ADR-0004). The successor to the
 * token-overlap matcher in ./match.ts. Multilingual by construction: an English
 * ingredient finds the Dutch product ("mushroom" -> champignons) with no synonym
 * table, because the vectors carry the meaning.
 *
 * Two tiers, so we only pay for the LLM where accuracy matters:
 *  - CHEAP (cosine top-1, no LLM): price totals + staples search. A week's list
 *    across stores is ~60 lines; per-line LLM reranks would be too slow/costly.
 *    Confidence comes from the cosine score.
 *  - ACCURATE (cosine top-K -> LLM rerank): the AH cart path, where we build the
 *    real basket. The model picks the right SKU + judges quantity plausibility.
 *
 * The retrieval (loading the D1 vector index) is injected as `candidates` /
 * `queryVector`, so this module is pure and unit-tested; the server wrapper
 * (match-server.ts) wires the embed call + the loaded index. Returns the existing
 * `IngredientMatch` shape, so confidence/estimated semantics are preserved and a
 * weak guess is never treated as a real shelf price.
 */

import { topK } from '../embeddings/codec'
import { candidateId, runRerank } from './rerank-sku'
import type {
  ProductCandidate,
  IngredientQuery,
  RerankDeps,
} from './rerank-sku'
import type { ProductVectorEntry } from '../embeddings/store'
import type { IngredientMatch, MatchConfidence, StoreProduct } from './types'

export type { ProductCandidate, IngredientQuery } from './rerank-sku'

const NO_MATCH = (store: string): IngredientMatch => ({
  store,
  product: null,
  priceCents: null,
  confidence: 'none',
  estimated: true,
  score: 0,
})

/**
 * Map a cosine score to a confidence band. Calibrated for text-embedding-3-small
 * at 256 dims (EMBEDDING_DIMENSIONS): the Matryoshka reduction compresses every
 * vector toward a high baseline, so UNRELATED products sit at a ~0.48-0.52 noise
 * floor while a genuine match lands ~0.7+ (measured: "tarwebloem" -> "AH
 * Tarwebloem" 0.72, vs 0.50-0.52 for unrelated rolls/baby food). The old 0.45
 * `medium` cutoff was BELOW that floor, so a no-match was dressed up as a
 * confident match. Bands now start above the noise floor; tune against the admin
 * scenario runner as coverage grows.
 */
export function confidenceFromCosine(score: number): MatchConfidence {
  if (score >= 0.62) return 'high'
  if (score >= 0.55) return 'medium'
  if (score >= 0.5) return 'low'
  return 'none'
}

/**
 * Below this cosine a candidate is at/under the 256-dim noise floor, so it is not
 * a real match: drop it rather than retrieve/rerank it (a missing product should
 * read as "no match", not a confident wrong one).
 */
const RETRIEVE_FLOOR = 0.5

/**
 * Merge top-K from multiple query vectors (e.g. English + Dutch search terms).
 * Keeps the best cosine score per product id across all queries.
 */
export function selectCandidatesFromQueries(
  queryVectors: ReadonlyArray<ReadonlyArray<number>>,
  entries: ReadonlyArray<ProductVectorEntry>,
  lookup: ReadonlyMap<string, StoreProduct>,
  k: number,
): Array<ProductCandidate> {
  const best = new Map<string, number>()
  const scanK = Math.max(k * 3, 30)
  for (const qv of queryVectors) {
    for (const h of topK(qv, entries, scanK)) {
      if (h.score < RETRIEVE_FLOOR) continue
      const prev = best.get(h.id)
      if (prev === undefined || h.score > prev) best.set(h.id, h.score)
    }
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
  const out: Array<ProductCandidate> = []
  for (const [id, score] of ranked) {
    const product = lookup.get(id)
    if (product) out.push({ product, score })
  }
  return out
}

export function selectCandidates(
  queryVector: ReadonlyArray<number>,
  entries: ReadonlyArray<ProductVectorEntry>,
  lookup: ReadonlyMap<string, StoreProduct>,
  k: number,
): Array<ProductCandidate> {
  const hits = topK(queryVector, entries, k)
  const out: Array<ProductCandidate> = []
  for (const h of hits) {
    if (h.score < RETRIEVE_FLOOR) continue
    const product = lookup.get(h.id)
    if (product) out.push({ product, score: h.score })
  }
  return out
}

function toMatch(
  store: string,
  candidate: ProductCandidate,
  confidence: MatchConfidence,
): IngredientMatch {
  return {
    store,
    product: candidate.product,
    priceCents: candidate.product.priceCents,
    confidence,
    estimated: confidence !== 'high',
    score: candidate.score,
  }
}

/** CHEAP tier: the top candidate, confidence from its cosine score. No LLM. */
export function cheapMatch(
  store: string,
  candidates: ReadonlyArray<ProductCandidate>,
): IngredientMatch {
  const best = candidates[0]
  if (!best) return NO_MATCH(store)
  const confidence = confidenceFromCosine(best.score)
  if (confidence === 'none') return NO_MATCH(store)
  return toMatch(store, best, confidence)
}

/**
 * ACCURATE tier: LLM rerank over the candidates. The model's pick + confidence
 * win. A real decline (productId null) is honoured as NO_MATCH. With no model
 * (no key) we fall back to the cheap top-1 so the cart still fills; a model error
 * does the same (never crash a basket build).
 */
export async function rerankMatch(
  ingredient: IngredientQuery,
  candidates: ReadonlyArray<ProductCandidate>,
  store: string,
  deps: RerankDeps,
): Promise<{
  match: IngredientMatch
  reason?: string
  declined?: boolean
  llmFallback?: boolean
}> {
  if (candidates.length === 0) return { match: NO_MATCH(store) }
  if (!deps.model) {
    return { match: cheapMatch(store, candidates), llmFallback: true }
  }

  try {
    const result = await runRerank(ingredient, candidates, deps)
    if (!result) return { match: NO_MATCH(store) }
    if (result.kind === 'decline') {
      return { match: NO_MATCH(store), reason: result.reason, declined: true }
    }
    return {
      match: toMatch(store, result.candidate, result.confidence),
      reason: result.reason,
    }
  } catch {
    return { match: cheapMatch(store, candidates), llmFallback: true }
  }
}

export { candidateId }
