/**
 * Embedding ingredient -> product (SKU) matcher (ADR-0004). The successor to the
 * token-overlap matcher in ./match.ts. Multilingual by construction: an English
 * ingredient finds the Dutch product ("mushroom" -> champignons) with no synonym
 * table, because the vectors carry the meaning.
 *
 * Embeddings retrieve candidates. A very confident cosine winner can be accepted
 * directly; otherwise the reranker validates the actual product. Plain "high"
 * cosine is not enough for product truth: "almond flour" can sit near almond
 * cake, and "chilli flakes" can sit near Doritos Sweet chilli.
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
 * Embedding-only acceptance threshold. This is deliberately stricter than the
 * user-facing "high" confidence band: a direct match needs a strong top score
 * AND daylight over the second candidate. Ambiguous high-ish neighbours still go
 * to rerank.
 */
export const EMBEDDING_ONLY_MIN_SCORE = 0.7
export const EMBEDDING_ONLY_MIN_MARGIN = 0.06
export const EMBEDDING_ONLY_VERY_HIGH_SCORE = 0.8

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

/**
 * Fast path: accept the top embedding candidate only when it is both absolutely
 * strong and clearly separated from the runner-up. Returns null when the match
 * needs rerank validation.
 */
export function embeddingOnlyMatch(
  candidates: ReadonlyArray<ProductCandidate>,
  store: string,
): IngredientMatch | null {
  const top = candidates[0]
  if (!top) return null

  const secondScore = candidates[1]?.score ?? 0
  const margin = top.score - secondScore
  if (top.score >= EMBEDDING_ONLY_VERY_HIGH_SCORE) {
    return toMatch(store, top, 'high')
  }
  if (
    top.score < EMBEDDING_ONLY_MIN_SCORE ||
    margin < EMBEDDING_ONLY_MIN_MARGIN
  ) {
    return null
  }

  return toMatch(store, top, 'high')
}

/**
 * Final match tier: accept a decisive embedding winner, otherwise LLM-rerank the
 * candidates. The model's pick + confidence win. A real decline (productId null)
 * is honoured as NO_MATCH. With no model, or when the model errors, return
 * NO_MATCH rather than accepting ambiguous raw cosine as product truth.
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
  embeddingOnly?: boolean
}> {
  if (candidates.length === 0) return { match: NO_MATCH(store) }
  const direct = embeddingOnlyMatch(candidates, store)
  if (direct) return { match: direct, embeddingOnly: true }
  if (!deps.model) {
    return { match: NO_MATCH(store), llmFallback: true }
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
    return { match: NO_MATCH(store), llmFallback: true }
  }
}

export { candidateId }
