/**
 * Set-maths "similar recipes" scoring (replaces the Cloudflare Vectorize + Workers
 * AI embeddings path). Pure and runtime-free: token overlap over the same
 * `recipeText` (title + cuisine + ingredients) the embeddings used, plus a
 * same-cuisine boost. No network, no binding, no embed job, so it runs identically
 * in local dev and prod with zero Cloudflare-account setup.
 *
 * Quality note: token-overlap (Jaccard) is less "semantic" than a multilingual
 * embedding, but it is deterministic, instant over this catalogue size, and good
 * enough for "swap this meal for a similar one" (shared ingredients + same cuisine
 * dominate the score). If semantic recall ever matters more than setup simplicity,
 * this is the one function to swap back to a vector index behind.
 */

import { recipeText } from './recipe-text'
import type { RecipeForEmbedding } from './recipe-text'

/** A scored neighbour: a recipe id and its similarity to the query (0..1). */
export interface ScoredNeighbour {
  id: string
  score: number
}

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/**
 * Tokenise recipe text into a set of word tokens. Splits on any non-alphanumeric
 * run (Unicode-aware so Dutch/accented words survive) and drops tokens shorter
 * than 3 chars (articles, units) so overlap reflects real content words.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3),
  )
}

/** Jaccard overlap of two token sets: |∩| / |∪|, 0 when both empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** A candidate the scorer needs: id + the text fields recipeText reads. */
export interface ScorableRecipe extends RecipeForEmbedding {
  id: string
}

/**
 * Rank `candidates` by similarity to `query`, nearest first, and return the top
 * `topK` as {id, score}. Score = token-overlap (Jaccard) over recipeText, plus a
 * fixed +0.15 same-cuisine boost (capped at 1). The query recipe scores ~1 against
 * itself; callers (postProcessNeighbours) drop self afterwards. Deterministic and
 * pure: no DB, no Vectorize, no `cloudflare:workers`.
 */
export function rankBySimilarity(
  query: ScorableRecipe,
  candidates: Array<ScorableRecipe>,
  topK: number,
): Array<ScoredNeighbour> {
  const qTokens = tokenize(recipeText(query))
  const qCuisine = query.cuisine ? normalise(query.cuisine) : null

  const scored = candidates.map((c) => {
    let score = jaccard(qTokens, tokenize(recipeText(c)))
    if (qCuisine && c.cuisine && normalise(c.cuisine) === qCuisine) {
      score = Math.min(1, score + 0.15)
    }
    return { id: c.id, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
