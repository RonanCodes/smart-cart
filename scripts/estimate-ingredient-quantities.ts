/**
 * One-off, build-time estimation of per-ingredient QUANTITIES for the DEMO
 * recipe set. The scraped AH/Jumbo data is patchy: many ingredient lines carry
 * no amount at all, and the ones that do mix Dutch units ("2 el", "1 tl"). With
 * no usable quantity, the shopping list, the recipe sheet, and #293's food-waste
 * calc all come out blank / n-a. See issue #313.
 *
 * This estimates a numeric amount + a METRIC unit (g / ml / stuks) for every
 * ingredient line in the demo set, scaled to the recipe's `servings`, and bakes
 * it into data/seed/recipes.json. It NEVER overwrites a real scraped amount:
 *
 *   - The model produces an estimate for every line.
 *   - We write `ingredientsQty[idx] = { qty, unit }` (a parallel array aligned
 *     by index with `ingredients`) for the WHOLE line set.
 *   - We then fill the string `qty` / `unit` fields on `ingredients` AND
 *     `ingredientsEn` (the language-agnostic amount is shared) ONLY where the
 *     line had no usable amount, so real AH/Jumbo quantities stay authoritative.
 *   - The recipe is stamped `quantitiesEstimated: true` so the UI can label the
 *     amounts + waste as "approx" (they are inferred, not from AH).
 *
 *   OPENAI_API_KEY=sk-... pnpm tsx scripts/estimate-ingredient-quantities.ts
 *   pnpm tsx scripts/estimate-ingredient-quantities.ts --all     # every recipe
 *   pnpm tsx scripts/estimate-ingredient-quantities.ts --force   # re-estimate
 *
 * Cache: a recipe that already has a non-empty `ingredientsQty` is skipped, so
 * re-runs are cheap and resumable. Mirrors scripts/translate-recipes.ts (#295)
 * for model, concurrency, checkpointing, and the never-overwrite discipline.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'

type MetricUnit = 'g' | 'ml' | 'stuks'

interface Ingredient {
  name: string
  qty?: string
  unit?: string
  productId?: string
}
interface QtyEstimate {
  qty: number
  unit: MetricUnit
}
interface SeedRecipe {
  id: string
  source: string
  title: string
  servings?: number | null
  imageUrl?: string | null
  ingredients: Array<Ingredient>
  ingredientsEn?: Array<Ingredient> | null
  /** Per-ingredient estimated metric amount, aligned by index (#313). */
  ingredientsQty?: Array<QtyEstimate> | null
  /** Marks the amounts as inferred so the UI labels them "approx" (#313). */
  quantitiesEstimated?: boolean
  [k: string]: unknown
}

const DATA = join(process.cwd(), 'data', 'seed', 'recipes.json')
const CONCURRENCY = 5

const isDemo = (r: SeedRecipe) =>
  (r.source === 'ah' || r.source === 'jumbo') && !!r.imageUrl

const hasText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== ''

/** Has the line already got a usable amount we should not stomp on? */
const lineHasAmount = (i: Ingredient) => hasText(i.qty) || hasText(i.unit)

const EstimateSchema = z.object({
  items: z.array(
    z.object({
      qty: z.number().positive(),
      unit: z.enum(['g', 'ml', 'stuks']),
    }),
  ),
})

async function estimateOne(r: SeedRecipe): Promise<void> {
  const ingredientNames = r.ingredients.map((i) => i.name)
  const servings = r.servings && r.servings > 0 ? r.servings : 4

  const { object } = await generateObject({
    model: openai('gpt-5-mini'),
    schema: EstimateSchema,
    prompt: [
      'You are a recipe quantity estimator for a Dutch supermarket meal app.',
      `Estimate the amount of each ingredient for a recipe that serves ${servings} people.`,
      'Rules:',
      '- Return ONE estimate per ingredient, in the SAME order and SAME count as the input list.',
      '- Use ONLY metric units: "g" for solids (weight), "ml" for liquids (volume), "stuks" for whole countable items (e.g. 2 eggs, 1 onion, 3 cloves).',
      '- qty is a positive number scaled to the WHOLE recipe at the given servings (not per-serving).',
      '- Be realistic for a home recipe: a clove of garlic is ~3 g or 1 stuks; a litre of stock is 1000 ml; a tin of chickpeas is ~400 g.',
      '- Salt / pepper / spices to taste: estimate a small amount (e.g. 2 g), never 0.',
      '- Do NOT add, drop, or reorder ingredients. Do NOT use em-dashes or en-dashes.',
      '',
      `Ingredients (${ingredientNames.length} items), in order:`,
      JSON.stringify(ingredientNames),
    ].join('\n'),
  })

  // Defensive: if the model returned a wrong-length array, pad/truncate to keep
  // the parallel array aligned by index so downstream never misreads a line.
  const estimates: Array<QtyEstimate> = r.ingredients.map((_, idx) => {
    const e = object.items[idx]
    if (e && Number.isFinite(e.qty) && e.qty > 0) {
      return { qty: Math.round(e.qty * 10) / 10, unit: e.unit }
    }
    return { qty: 1, unit: 'stuks' } // never leave a hole
  })

  r.ingredientsQty = estimates
  r.quantitiesEstimated = true

  // Fill the string qty/unit ONLY where the line had no usable amount, so a real
  // scraped "350 g" stays authoritative. The amount is language-agnostic, so the
  // same estimate goes on the Dutch line and the parallel English line (#295).
  const fill = (lines: Array<Ingredient> | null | undefined) => {
    if (!Array.isArray(lines)) return
    lines.forEach((line, idx) => {
      if (lineHasAmount(line)) return
      const e = estimates[idx]
      if (!e) return
      line.qty = String(e.qty)
      line.unit = e.unit
    })
  }
  fill(r.ingredients)
  fill(r.ingredientsEn)
}

async function main() {
  const all = process.argv.includes('--all')
  const force = process.argv.includes('--force')

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      '[estimate] OPENAI_API_KEY is not set. Aborting (no runtime fallback).',
    )
    process.exit(1)
  }

  const recipes = JSON.parse(readFileSync(DATA, 'utf8')) as Array<SeedRecipe>
  const target = recipes.filter((r) => (all ? true : isDemo(r)))
  const todo = target.filter(
    (r) =>
      force ||
      !Array.isArray(r.ingredientsQty) ||
      r.ingredientsQty.length === 0,
  )

  console.log(
    `[estimate] ${recipes.length} total, ${target.length} in scope (${all ? 'ALL' : 'demo set'}), ${todo.length} to estimate${force ? ' (force)' : ''}.`,
  )
  if (todo.length === 0) {
    console.log('[estimate] nothing to do (all in-scope recipes cached).')
    return
  }

  let done = 0
  let failed = 0
  const queue = [...todo]
  async function worker(): Promise<void> {
    for (;;) {
      const r = queue.shift()
      if (!r) return
      try {
        await estimateOne(r)
        done++
      } catch (err) {
        failed++
        console.error(`[estimate] FAILED ${r.id}: ${(err as Error).message}`)
      }
      if ((done + failed) % 10 === 0 || done + failed === todo.length) {
        console.log(
          `[estimate] ${done + failed}/${todo.length} (${failed} failed)`,
        )
        // Checkpoint to disk so a crash mid-run is resumable (cache by qty array).
        writeFileSync(DATA, JSON.stringify(recipes, null, 2) + '\n')
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  )

  writeFileSync(DATA, JSON.stringify(recipes, null, 2) + '\n')
  console.log(
    `[estimate] done. ${done} estimated, ${failed} failed. Wrote ${DATA}.`,
  )
}

main()
