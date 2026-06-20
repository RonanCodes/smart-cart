/**
 * Expand a recipe ingredient into 1–3 supermarket search strings before embedding.
 * English queries like "minced chicken" embed closer to "noodles sesame chicken"
 * than to Dutch "kipgehakt" at 256d; a fast LLM adds the Dutch grocery term
 * so retrieval can union both vectors (ADR-0004 cross-language fix).
 */

import { z } from 'zod'
import type { LanguageModel } from 'ai'

export const expandSchema = z.object({
  terms: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      'Short search strings for a Dutch supermarket catalogue: the original ' +
        'ingredient plus the usual Dutch product name when different ' +
        '(e.g. minced chicken -> kipgehakt, mushroom -> champignons).',
    ),
})

const SYSTEM = `You prepare search strings for finding a RAW supermarket ingredient in Albert Heijn / Jumbo.

Return 1–3 short terms (single words or short phrases, no sentences):
- Always include the original ingredient text.
- When the ingredient is English (or not how Dutch products are labelled), add the standard Dutch grocery name shoppers would find on shelf labels.
- Raw ingredients only: gehakt, whole vegetables, flour, milk — not prepared meals, sauces, or snacks.
- Dutch flour gotcha: never use bare "bloem" (embeddings confuse it with bloemkool/cauliflower). For flour use tarwebloem, patent bloem, bakbloem, or zelfrijzend bakmeel as appropriate.
- Examples: "minced chicken" -> ["minced chicken", "kipgehakt"]; "mushroom" -> ["mushroom", "champignons"]; "00 flour" -> ["00 flour", "tarwebloem"]; "tarwebloem" -> ["tarwebloem"].`

export type ExpandGenerateObject = (args: {
  model: LanguageModel
  schema: typeof expandSchema
  system: string
  prompt: string
  span_info?: { name?: string; metadata?: Record<string, unknown> }
}) => Promise<{ object: z.infer<typeof expandSchema> }>

/** Dedupe, trim, drop empties; always keep at least the original ingredient. */
export function normaliseSearchTerms(
  ingredient: string,
  terms: ReadonlyArray<string>,
): Array<string> {
  const base = ingredient.trim()
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const t of [base, ...terms]) {
    const s = t.trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.length > 0 ? out : [base]
}

/**
 * LLM expand for Dutch supermarket search. On failure returns [ingredient] only.
 * Injectable generateObject for tests.
 */
export async function expandIngredientSearchTerms(
  ingredient: string,
  deps: {
    model?: LanguageModel | null
    generateObject?: ExpandGenerateObject
  },
): Promise<{ terms: Array<string>; expandFallback: boolean }> {
  const base = ingredient.trim()
  if (!base || !deps.model) return { terms: [base], expandFallback: true }

  try {
    const gen = deps.generateObject ?? (await loadExpandGenerateObject())
    const { object } = await gen({
      model: deps.model,
      schema: expandSchema,
      system: SYSTEM,
      prompt: `Ingredient: ${base}`,
      span_info: { name: 'expand-ingredient', metadata: { ingredient: base } },
    })
    return {
      terms: normaliseSearchTerms(base, expandSchema.parse(object).terms),
      expandFallback: false,
    }
  } catch {
    return { terms: [base], expandFallback: true }
  }
}

async function loadExpandGenerateObject(): Promise<ExpandGenerateObject> {
  const { generateObject } = await import('../braintrust-ai')
  return generateObject
}
