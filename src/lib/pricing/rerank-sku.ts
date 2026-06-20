/**
 * LLM rerank for ingredient -> SKU, the accurate tier of match-semantic.ts
 * (ADR-0004). Cosine retrieval gives the top-K nearest products; the model picks
 * the one a real shopper would buy for THIS ingredient and quantity (a normal
 * pack, not a catering bag for "2 cloves"; the raw ingredient over a prepared
 * dish, champignons not champignonsoep). It can only choose a candidate's
 * productId or decline; it never invents a product.
 *
 * Used only on the cart decision point (bounded call count). Price totals and
 * staples search use the cheap cosine top-1 tier, no LLM.
 *
 * Pure schema + prompt; the live call is gated and injectable so tests stub it.
 */

import { z } from 'zod'
import type { LanguageModel } from 'ai'
import type { StoreProduct } from './types'

/** One retrieved product plus its cosine score (0..1, higher is nearer). */
export interface ProductCandidate {
  product: StoreProduct
  score: number
}

/** The ingredient to resolve. qty/unit feed the model's pack-size reasoning. */
export interface IngredientQuery {
  name: string
  qty?: string | null
  unit?: string | null
}

/**
 * Structured output. The model returns the productId of its chosen candidate (or
 * null to decline), a confidence band, and a one-line reason. Choosing by id (not
 * free text) is what stops it inventing a product.
 */
export const rerankSchema = z.object({
  productId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  reason: z.string(),
})

export type RerankResult = z.infer<typeof rerankSchema>

const SYSTEM_PROMPT = `You match a recipe ingredient to the supermarket product a real shopper would put in their basket for it. You get the ingredient (with quantity if known) and a numbered list of candidate products already retrieved from one store.

Rules:
- Pick the productId of the candidate a sensible shopper would buy for THIS ingredient and quantity. Prefer a normal household pack over catering/bulk unless the quantity is large.
- Prefer the raw ingredient over a prepared dish (e.g. "champignons" over "champignonsoep").
- Candidates may be Dutch and the ingredient English (or vice versa). Match on meaning, not spelling ("mushroom" matches "champignons").
- If NO candidate is a reasonable match, return productId null and confidence "none".
- confidence: "high" when the product clearly IS the ingredient; "medium" when it is the right thing in a slightly off form/size; "low" when it is a stretch.
- Never return an id that is not in the list.`

/** Build the rerank prompt. Pure, testable. */
export function buildRerankPrompt(
  ingredient: IngredientQuery,
  candidates: ReadonlyArray<ProductCandidate>,
): { system: string; prompt: string } {
  const qty = [ingredient.qty, ingredient.unit].filter(Boolean).join(' ').trim()
  const lines = candidates.map((c) => {
    const price = (c.product.priceCents / 100).toFixed(2)
    const size = c.product.size.raw ? `, ${c.product.size.raw}` : ''
    const id = c.product.slug ?? c.product.normalisedName
    return `- ${id}: ${c.product.name} (EUR ${price}${size})`
  })
  return {
    system: SYSTEM_PROMPT,
    prompt: [
      `Ingredient: ${ingredient.name}${qty ? ` (${qty})` : ''}`,
      '',
      'Candidates (productId: name):',
      ...lines,
    ].join('\n'),
  }
}

/** The id used to refer to a candidate in the prompt + the model's answer. */
export function candidateId(product: StoreProduct): string {
  return product.slug ?? product.normalisedName
}

/** The `generateObject` shape we depend on (injectable for tests). */
export type GenerateObjectFn = (args: {
  model: LanguageModel
  schema: typeof rerankSchema
  system: string
  prompt: string
}) => Promise<{ object: RerankResult }>

export interface RerankDeps {
  model?: LanguageModel | null
  generateObject?: GenerateObjectFn
}

/**
 * Run the LLM rerank. Returns the chosen candidate + confidence, or null when the
 * model genuinely declines (productId null / confidence none) or names an id not
 * in the list. THROWS on a transport/parse error so the caller can tell a real
 * "none fit" from a transient failure (match-semantic drops the line on a decline
 * but falls back to the cheap top-1 on an error). Returns null with no model.
 */
export async function runRerank(
  ingredient: IngredientQuery,
  candidates: ReadonlyArray<ProductCandidate>,
  deps: RerankDeps,
): Promise<{
  candidate: ProductCandidate
  confidence: RerankResult['confidence']
} | null> {
  if (candidates.length === 0 || !deps.model) return null
  const { system, prompt } = buildRerankPrompt(ingredient, candidates)
  const gen = deps.generateObject ?? (await loadGenerateObject())
  const { object } = await gen({
    model: deps.model,
    schema: rerankSchema,
    system,
    prompt,
  })
  const { productId, confidence } = rerankSchema.parse(object)
  if (!productId || confidence === 'none') return null
  const chosen = candidates.find((c) => candidateId(c.product) === productId)
  if (!chosen) return null
  return { candidate: chosen, confidence }
}

async function loadGenerateObject(): Promise<GenerateObjectFn> {
  const { generateObject } = await import('ai')
  return generateObject
}
