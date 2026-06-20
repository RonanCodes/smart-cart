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

/** The ingredient to resolve. qty/unit and optional recipe context feed rerank. */
export interface IngredientQuery {
  name: string
  qty?: string | null
  unit?: string | null
  /** Recipe title when known (helps disambiguate form/fit). */
  recipeTitle?: string | null
  /** e.g. vegetarian, vegan — steer away from meat/dairy when set. */
  dietaryTags?: ReadonlyArray<string>
}

/**
 * Structured output. The model returns the productId of its chosen candidate (or
 * null to decline), a confidence band, and a one-line reason. Choosing by id (not
 * free text) is what stops it inventing a product; field descriptions are passed
 * to the model via the AI SDK schema.
 */
export const rerankSchema = z.object({
  productId: z
    .string()
    .nullable()
    .describe(
      'Exact productId slug copied from ONE candidate (e.g. "ah-gehakt"). ' +
        'Never the product display name. Null when no candidate fits.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low', 'none'])
    .describe(
      '"high" = clearly the ingredient; "medium" = right thing, off size/form; ' +
        '"low" = stretch; "none" = decline (use with productId null).',
    ),
  reason: z
    .string()
    .describe('One short sentence explaining the pick or decline.'),
})

export type RerankResult = z.infer<typeof rerankSchema>

const SYSTEM_PROMPT = `You match ONE recipe ingredient to ONE supermarket SKU from a fixed candidate list retrieved by semantic search. You cannot add products or change names.

Critical output rule:
- productId MUST be copied exactly from a candidate's "productId:" field below.
- NEVER return the product display name as productId (wrong: "AH Mager rundergehakt"; right: "ah-gehakt").
- If nothing fits, return productId null and confidence "none".

Selection rules (in order):
1. Match the ingredient's meaning, not spelling (English "mushroom" -> Dutch "champignons").
2. Prefer the raw/fresh ingredient the recipe calls for, not a prepared dish, sauce, snack, or ready meal (champignons not champignonsoep; tarwebloem not brood).
3. Prefer real meat/fish/dairy over plant-based meat/dairy substitutes unless the ingredient explicitly names a substitute (vegan, plant-based, redefine, beyond) OR dietary constraints require it.
4. Match pack size when the ingredient specifies quantity or unit (500 g -> ~500 g or 1 kg household pack; "2 l" -> ~2 l bottle; not a 24-pack unless quantity is large).
5. Prefer a normal household pack over catering/bulk unless the recipe quantity is clearly large.
6. If the ingredient names a size (e.g. "2 l") and no candidate is a reasonable size match, decline — do not pick the nearest brand in the wrong size.

Confidence:
- high: the product clearly IS what the recipe wants.
- medium: right ingredient, slightly wrong pack or form.
- low: plausible stretch only.
- none: no candidate fits; productId null.`

/** Build the rerank prompt. Pure, testable. */
export function buildRerankPrompt(
  ingredient: IngredientQuery,
  candidates: ReadonlyArray<ProductCandidate>,
): { system: string; prompt: string } {
  const qty = [ingredient.qty, ingredient.unit].filter(Boolean).join(' ').trim()
  const blocks = candidates.map((c, i) => {
    const id = candidateId(c.product)
    const price = (c.product.priceCents / 100).toFixed(2)
    const pack = c.product.size.raw.trim() || 'unknown'
    return [
      `${i + 1}. productId: ${id}`,
      `   name: ${c.product.name}`,
      `   pack: ${pack}`,
      `   price: EUR ${price}`,
      `   retrieval score: ${c.score.toFixed(3)}`,
    ].join('\n')
  })

  const context: Array<string> = [
    `Ingredient to buy: ${ingredient.name}${qty ? ` (${qty})` : ''}`,
  ]
  if (ingredient.recipeTitle?.trim()) {
    context.push(`Recipe: ${ingredient.recipeTitle.trim()}`)
  }
  if (ingredient.dietaryTags?.length) {
    context.push(`Dietary constraints: ${ingredient.dietaryTags.join(', ')}`)
  }

  const validIds = candidates.map((c) => candidateId(c.product)).join(', ')

  return {
    system: SYSTEM_PROMPT,
    prompt: [
      ...context,
      '',
      'Candidates (pick AT MOST ONE; copy its productId exactly):',
      ...blocks,
      '',
      `Valid productId values: ${validIds}`,
    ].join('\n'),
  }
}

/** The id used to refer to a candidate in the prompt + the model's answer. */
export function candidateId(product: StoreProduct): string {
  return product.slug ?? product.normalisedName
}

function norm(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Map the model's productId answer back to a candidate. Exact slug match first;
 * then common model mistakes (display name instead of slug, case drift).
 */
export function resolveCandidate(
  productId: string,
  candidates: ReadonlyArray<ProductCandidate>,
): ProductCandidate | undefined {
  const raw = productId.trim()
  if (!raw) return undefined

  const exact = candidates.find((c) => candidateId(c.product) === raw)
  if (exact) return exact

  const lower = norm(raw)
  const ciId = candidates.find((c) => norm(candidateId(c.product)) === lower)
  if (ciId) return ciId

  // Models often return the display name despite instructions (Braintrust eval bug).
  const byName = candidates.find(
    (c) => c.product.name === raw || norm(c.product.name) === lower,
  )
  if (byName) return byName

  const byNormName = candidates.find(
    (c) => norm(c.product.normalisedName) === lower,
  )
  if (byNormName) return byNormName

  // Strip common AH prefix the model may echo back with the name.
  const stripped = raw.replace(/^ah\s+/i, '').trim()
  if (stripped !== raw) {
    const byStripped = candidates.find(
      (c) =>
        norm(c.product.name) === norm(stripped) ||
        norm(c.product.normalisedName) === norm(stripped),
    )
    if (byStripped) return byStripped
  }

  return undefined
}

/** The `generateObject` shape we depend on (injectable for tests). */
export type GenerateObjectFn = (args: {
  model: LanguageModel
  schema: typeof rerankSchema
  system: string
  prompt: string
  span_info?: { name?: string; metadata?: Record<string, unknown> }
}) => Promise<{ object: RerankResult }>

export interface RerankDeps {
  model?: LanguageModel | null
  generateObject?: GenerateObjectFn
}

export type RerankRunResult =
  | {
      kind: 'pick'
      candidate: ProductCandidate
      confidence: RerankResult['confidence']
      reason: string
    }
  | { kind: 'decline'; reason: string }

/**
 * Run the LLM rerank. Returns a pick, a decline (with reason), or null when
 * there is no model / no candidates. THROWS on transport/parse errors.
 */
export async function runRerank(
  ingredient: IngredientQuery,
  candidates: ReadonlyArray<ProductCandidate>,
  deps: RerankDeps,
): Promise<RerankRunResult | null> {
  if (candidates.length === 0 || !deps.model) return null
  const { system, prompt } = buildRerankPrompt(ingredient, candidates)
  const gen = deps.generateObject ?? (await loadGenerateObject())
  const { object } = await gen({
    model: deps.model,
    schema: rerankSchema,
    system,
    prompt,
    span_info: {
      name: 'rerank-sku',
      metadata: { ingredient: ingredient.name },
    },
  })
  const { productId, confidence, reason } = rerankSchema.parse(object)
  if (!productId || confidence === 'none') {
    return {
      kind: 'decline',
      reason: reason || 'No candidate fits this ingredient.',
    }
  }
  const chosen = resolveCandidate(productId, candidates)
  if (!chosen) {
    return {
      kind: 'decline',
      reason:
        reason ||
        `Model returned productId "${productId}" which is not in the candidate list.`,
    }
  }
  return { kind: 'pick', candidate: chosen, confidence, reason }
}

async function loadGenerateObject(): Promise<GenerateObjectFn> {
  const { generateObject } = await import('../braintrust-ai')
  return generateObject
}
