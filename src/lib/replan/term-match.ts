/**
 * Build the semantic term matcher for a replan exclude / more-of (ADR-0004).
 *
 * The old path expanded a typed term ("rice") through an EN/NL synonym table and
 * substring-matched it against the Dutch catalogue text. This replaces that with an
 * embedding: the term is embedded once (live, OpenAI text-embedding-3-small 256d),
 * then a recipe matches the term when the cosine between the term vector and the
 * recipe's PRECOMPUTED vector clears a threshold. So "mushroom" matches a Dutch
 * "champignonrisotto" with no synonym table, in any language the model covers.
 *
 * The term needs a live embed (the catalogue vectors are precomputed in D1, the
 * user's typed term is not), so this path requires an OpenAI key. With no key the
 * caller never builds a matcher and the exclude / more-of intents decline cleanly;
 * we never fall back to substring matching.
 *
 * The cosine maths lives in the pure `buildTermMatcher`, which takes the term vector
 * and the recipe vector index as inputs, so it is unit-tested offline with synthetic
 * vectors. The live wiring (`buildTermMatcherLive`) embeds the term and loads the
 * vectors, and is the part that needs the key + binding.
 */

import { cosineSimilarity } from 'ai'
import type { PlannerRecipe } from '../planner/types'
import type { TermMatcher } from './types'

/**
 * Cosine threshold above which a recipe counts as matching the term. Tuned for
 * text-embedding-3-small at 256d: a clear topical match ("mushroom" vs a mushroom
 * dish) sits well above this, an unrelated dish well below. Start point per
 * ADR-0004; raise it if matches feel loose, lower it if real matches are missed.
 */
export const TERM_MATCH_THRESHOLD = 0.35

/**
 * Build a pure term matcher from an already-embedded term vector and a recipe
 * vector index (recipe id -> vector). A recipe matches when cosine(term, recipe)
 * exceeds the threshold. A recipe with no vector never matches (it cannot be
 * scored). Pure: no embed call, no DB.
 */
export function buildTermMatcher(
  termVector: ReadonlyArray<number>,
  recipeVectors: Map<string, ReadonlyArray<number>>,
  threshold: number = TERM_MATCH_THRESHOLD,
): TermMatcher {
  const term = termVector as Array<number>
  return (recipe: PlannerRecipe): boolean => {
    const v = recipeVectors.get(recipe.id)
    if (!v) return false
    return cosineSimilarity(term, v as Array<number>) >= threshold
  }
}

/** Embeds one term to a vector. Matches the embeddings module's `embedQuery`. */
export type EmbedTermFn = (text: string) => Promise<Array<number>>

/**
 * Live builder: embed the term, then build the pure matcher against the loaded
 * recipe vector index. Returns null when there is nothing to match (empty term or
 * an empty vector index), so the caller declines cleanly. The key/binding
 * requirement is the `embed` call; the server only calls this when a key is wired.
 */
export async function buildTermMatcherLive(
  term: string,
  recipeVectors: Map<string, ReadonlyArray<number>>,
  embed: EmbedTermFn,
  threshold: number = TERM_MATCH_THRESHOLD,
): Promise<TermMatcher | null> {
  const t = term.trim()
  if (!t || recipeVectors.size === 0) return null
  const termVector = await embed(t)
  return buildTermMatcher(termVector, recipeVectors, threshold)
}

/**
 * Conservative substring matcher on title + ingredients. Used alongside embeddings
 * for exclude so terms like "risotto" still catch Dutch titles without a vector.
 */
export function substringTermMatcher(term: string): TermMatcher | null {
  const t = term.trim().toLowerCase()
  if (!t) return null
  return (recipe: PlannerRecipe): boolean => {
    const text = [
      recipe.title,
      recipe.cuisine ?? '',
      ...recipe.ingredients.map((i) => i.name),
    ]
      .join(' ')
      .toLowerCase()
    return text.includes(t)
  }
}

/** Union of matchers: a recipe matches when any constituent matcher matches. */
export function combineTermMatchers(
  ...matchers: Array<TermMatcher | null | undefined>
): TermMatcher | null {
  const active = matchers.filter((m): m is TermMatcher => m != null)
  if (active.length === 0) return null
  return (recipe) => active.some((m) => m(recipe))
}
