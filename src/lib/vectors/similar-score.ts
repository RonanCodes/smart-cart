/**
 * "Similar recipes" scoring by embedding cosine (ADR-0004). Ranks candidates by
 * cosine similarity over precomputed recipe vectors (OpenAI text-embedding-3-small,
 * 256d), plus a small same-cuisine boost. Both the query recipe and the candidates
 * already have vectors in D1 (recipe_embedding), so this path needs NO live embed
 * call: the caller loads the vector index once and hands it in.
 *
 * Replaces the old set-maths (Jaccard token overlap) scorer. Cosine over a
 * multilingual embedding picks up cross-language and semantic neighbours that token
 * overlap missed (a Dutch "champignonrisotto" is near an English "mushroom risotto"
 * even with no shared tokens), which is the whole point of the pivot.
 *
 * Pure: no DB, no binding, no network. The vector index is an input, so the scorer
 * is unit-tested with synthetic vectors.
 */

import { cosineSimilarity } from 'ai'
import type { RecipeForEmbedding } from './recipe-text'

/** A scored neighbour: a recipe id and its similarity to the query (0..1-ish). */
export interface ScoredNeighbour {
  id: string
  score: number
}

/** A candidate the scorer ranks: an id plus the cuisine used for the boost. */
export interface ScorableRecipe extends RecipeForEmbedding {
  id: string
}

/** Recipe id -> its precomputed embedding vector. */
export type VectorIndex = Map<string, ReadonlyArray<number>>

/** Same-cuisine nudge, capped so it never lifts a score past 1. */
const SAME_CUISINE_BOOST = 0.05

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/**
 * Rank `candidates` by cosine similarity to `query`, nearest first, and return the
 * top `topK` as {id, score}. The query recipe's vector is looked up in `vectors` by
 * its id; each candidate's vector likewise. A candidate with no vector is skipped
 * (it cannot be scored), and an absent query vector yields an empty result (the
 * caller degrades). A small same-cuisine boost breaks near-ties toward the same
 * cuisine. The query recipe scores ~1 against itself; callers
 * (postProcessNeighbours) drop self afterwards.
 *
 * Pure: no DB, no embed call, no `cloudflare:workers`. Vectors are precomputed and
 * passed in, so this runs keyless.
 */
export function rankBySimilarity(
  query: ScorableRecipe,
  candidates: ReadonlyArray<ScorableRecipe>,
  vectors: VectorIndex,
  topK: number,
): Array<ScoredNeighbour> {
  const qVector = vectors.get(query.id)
  if (!qVector) return []
  const q = qVector as Array<number>
  const qCuisine = query.cuisine ? normalise(query.cuisine) : null

  const scored: Array<ScoredNeighbour> = []
  for (const c of candidates) {
    const cVector = vectors.get(c.id)
    if (!cVector) continue // no vector, cannot score this candidate
    let score = cosineSimilarity(q, cVector as Array<number>)
    if (qCuisine && c.cuisine && normalise(c.cuisine) === qCuisine) {
      score = Math.min(1, score + SAME_CUISINE_BOOST)
    }
    scored.push({ id: c.id, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
