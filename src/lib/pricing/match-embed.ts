/**
 * Embedding + LLM rerank ingredient -> product matcher (ADR-0003).
 *
 * The successor to the token-overlap matcher in `./match.ts`. Two stages:
 *
 *   1. RETRIEVE: embed the ingredient name and pull the top-K nearest products
 *      from the `smart-cart-products` Vectorize index. bge-m3 is multilingual,
 *      so an English ingredient finds Dutch products with no synonym table
 *      ("mushroom" -> champignon / paddenstoel). This stage is injected as
 *      `retrieve` so the pure rerank logic is testable without a binding.
 *
 *   2. RERANK: hand the candidates to an LLM, which picks the product a shopper
 *      would actually buy for this ingredient and quantity (a sensible pack
 *      size, not a 5 kg catering bag for "2 cloves garlic"). The model can only
 *      choose from the candidate list or decline; it never invents a product.
 *
 * Offline-shippable, same contract as the replan AI fallback:
 *  - The schema + prompt builder are pure and unit tested.
 *  - With no model (no OPENAI_API_KEY binding) it degrades to the top vector hit,
 *    so the matcher still works, just without the quantity reasoning.
 *  - Any model error is caught and degraded the same way; a flaky model can never
 *    crash a basket build.
 *
 * Returns the SAME `IngredientMatch` shape as `matchIngredient`, so it is a
 * drop-in replacement: `estimated` / confidence semantics are preserved and a
 * weak guess is never silently treated as an exact shelf price.
 */

import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { IngredientMatch, MatchConfidence, StoreProduct } from './types'

/** One retrieved product plus its vector similarity score (0..1, higher closer). */
export interface ProductCandidate {
  product: StoreProduct
  score: number
}

/** The ingredient to resolve. `qty` / `unit` feed the LLM's pack-size reasoning. */
export interface IngredientQuery {
  name: string
  qty?: string | null
  unit?: string | null
}

/** Retrieve top-K candidate products for an ingredient name in a given store. */
export type RetrieveFn = (
  name: string,
  store: string,
  topK: number,
) => Promise<Array<ProductCandidate>>

const NO_MATCH = (store: string): IngredientMatch => ({
  store,
  product: null,
  priceCents: null,
  confidence: 'none',
  estimated: true,
  score: 0,
})

/**
 * Map a vector similarity score to a confidence band.
 *
 * bge-m3 cosine scores sit on a different scale to the old token overlap, so the
 * bands are their own thing (tune against the frozen fixture as coverage grows).
 * Used for the no-model fallback; when the LLM reranks, its own confidence wins.
 */
export function confidenceFromVectorScore(score: number): MatchConfidence {
  if (score >= 0.75) return 'high'
  if (score >= 0.6) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}

/** Below this vector score we do not trust a candidate enough to even rerank it. */
const RETRIEVE_FLOOR = 0.45

// --- Rerank: pure schema + prompt, gated live call --------------------------

/**
 * The structured-output schema. The model returns the INDEX of its chosen
 * candidate (or -1 to decline), a confidence band, and a short reason. Index
 * selection is what stops the model inventing a product: it can only point at
 * one we already retrieved.
 */
export const rerankSchema = z.object({
  choice: z.number().int(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
})

export type RerankResult = z.infer<typeof rerankSchema>

const SYSTEM_PROMPT = `You match a recipe ingredient to the supermarket product a real shopper would put in their basket for it. You are given the ingredient (with its quantity, if known) and a numbered list of candidate products already retrieved from the store.

Rules:
- Choose the candidate index a sensible shopper would buy for THIS ingredient and quantity. Prefer a normal household pack size over catering / bulk sizes unless the quantity is large.
- The candidates may be in Dutch and the ingredient in English (or vice versa). Match on meaning, not spelling ("mushroom" matches "champignons").
- If NONE of the candidates is a reasonable match for the ingredient, return choice -1.
- "confidence": "high" only when the product clearly IS the ingredient; "medium" when it is the right thing in a slightly off form/size; "low" when it is a stretch.
- Never invent a product. Only ever return an index from the list, or -1.`

/** Build the rerank prompt for an ingredient + its candidates. Pure, testable. */
export function buildRerankPrompt(
  ingredient: IngredientQuery,
  candidates: Array<ProductCandidate>,
): { system: string; prompt: string } {
  const qty = [ingredient.qty, ingredient.unit].filter(Boolean).join(' ').trim()
  const lines = candidates.map((c, i) => {
    const price = (c.product.priceCents / 100).toFixed(2)
    const size = c.product.size.raw ? `, ${c.product.size.raw}` : ''
    return `${i}: ${c.product.name} (EUR ${price}${size})`
  })
  return {
    system: SYSTEM_PROMPT,
    prompt: [
      `Ingredient: ${ingredient.name}${qty ? ` (${qty})` : ''}`,
      '',
      'Candidates:',
      ...lines,
    ].join('\n'),
  }
}

/**
 * The `generateObject` shape we depend on. Declaring it lets tests inject a stub
 * without the real provider and keeps the live import lazy (Worker-only).
 */
export type GenerateObjectFn = (args: {
  model: LanguageModel
  schema: typeof rerankSchema
  system: string
  prompt: string
}) => Promise<{ object: RerankResult }>

export interface RerankDeps {
  /** The model to rerank with. Absent => fall back to the top vector hit. */
  model?: LanguageModel | null
  /** `generateObject` impl. Defaults to the real lazy-loaded one; tests stub it. */
  generateObject?: GenerateObjectFn
}

/** Build an IngredientMatch from a chosen candidate + a confidence band. */
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
    // Only a 'high' match is trusted as a real price; everything else is soft.
    estimated: confidence !== 'high',
    score: candidate.score,
  }
}

/** Fall back to the highest-scoring candidate, confidence from its vector score. */
function topHit(
  store: string,
  candidates: Array<ProductCandidate>,
): IngredientMatch {
  const best = candidates[0]
  if (!best) return NO_MATCH(store)
  const confidence = confidenceFromVectorScore(best.score)
  if (confidence === 'none') return NO_MATCH(store)
  return toMatch(store, best, confidence)
}

/**
 * Rerank retrieved candidates with the LLM and return the chosen match.
 *
 * No model, no candidates, or an out-of-range / -1 choice all degrade safely:
 * to the top vector hit when there is one, to NO_MATCH when there is not.
 */
export async function rerankMatch(
  ingredient: IngredientQuery,
  candidates: Array<ProductCandidate>,
  store: string,
  deps: RerankDeps = {},
): Promise<IngredientMatch> {
  if (candidates.length === 0) return NO_MATCH(store)
  if (!deps.model) return topHit(store, candidates)

  const { system, prompt } = buildRerankPrompt(ingredient, candidates)
  try {
    const gen = deps.generateObject ?? (await loadGenerateObject())
    const { object } = await gen({
      model: deps.model,
      schema: rerankSchema,
      system,
      prompt,
    })
    const { choice, confidence } = rerankSchema.parse(object)
    const chosen = candidates[choice]
    // -1 (declined) or an out-of-range index => trust the model's "no" and stop,
    // rather than silently substituting the top hit it just rejected.
    if (choice < 0 || !chosen) return NO_MATCH(store)
    return toMatch(store, chosen, confidence)
  } catch {
    // Flaky/absent model must never break the basket: degrade to the top hit.
    return topHit(store, candidates)
  }
}

/**
 * The full ingredient -> product match: retrieve, then rerank.
 *
 * `retrieve` is injected (the live impl lives in product-vectors.ts and binds to
 * Vectorize) so this orchestration is fully testable with stubs.
 */
export async function matchIngredientEmbedded(
  ingredient: IngredientQuery,
  store: string,
  deps: RerankDeps & { retrieve: RetrieveFn; topK?: number },
): Promise<IngredientMatch> {
  const name = ingredient.name.trim()
  if (!name) return NO_MATCH(store)

  const raw = await deps.retrieve(name, store, deps.topK ?? 10)
  const candidates = raw
    .filter((c) => c.score >= RETRIEVE_FLOOR)
    .sort((a, b) => b.score - a.score)
  return rerankMatch(ingredient, candidates, store, deps)
}

/** Lazy-load the real `generateObject` so it never enters a non-Worker bundle. */
async function loadGenerateObject(): Promise<GenerateObjectFn> {
  const { generateObject } = await import('ai')
  return generateObject
}
