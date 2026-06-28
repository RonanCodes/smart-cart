/**
 * One-off, deterministic build-time translation of the DEMO recipe set from
 * Dutch to English. Writes `titleEn` / `ingredientsEn` / `instructionsEn`
 * ALONGSIDE the Dutch source fields in data/seed/recipes.json (never overwriting
 * them), so the shipped artifact is English baked into the seed (no runtime
 * translation calls). See issue #295.
 *
 *   OPENAI_API_KEY=sk-... pnpm tsx scripts/translate-recipes.ts
 *   pnpm tsx scripts/translate-recipes.ts --all        # translate ALL recipes
 *   pnpm tsx scripts/translate-recipes.ts --force      # re-translate (ignore cache)
 *
 * Scope (default): the demo set = AH/Jumbo dinner recipes WITH an imageUrl (~69), the
 * ones that can surface as a card in a generated week. The other ~1500 recipes
 * (foodcom/themealdb, already English; and imageless NL recipes that never show)
 * are left untranslated; pass --all to do everything.
 *
 * Cache: a recipe that already has a non-empty `titleEn` is skipped, so re-runs
 * are cheap and resumable. Quantities/units are language-agnostic and copied
 * verbatim; only ingredient `name` and the step text are translated, and the
 * ingredient/step arrays stay the same length + order so downstream parsing
 * (qty/unit split, consolidation) is unaffected.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'

interface Ingredient {
  name: string
  qty?: string
  unit?: string
  productId?: string
}
interface SeedRecipe {
  id: string
  source: string
  title: string
  imageUrl?: string | null
  ingredients: Array<Ingredient>
  instructions: Array<string>
  titleEn?: string | null
  ingredientsEn?: Array<Ingredient> | null
  instructionsEn?: Array<string> | null
  [k: string]: unknown
}

const DATA = join(process.cwd(), 'data', 'seed', 'recipes.json')
const CONCURRENCY = 5

const isDemo = (r: SeedRecipe) =>
  (r.source === 'ah' || r.source === 'jumbo') && !!r.imageUrl

const hasText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== ''

const TranslationSchema = z.object({
  titleEn: z.string(),
  ingredientNamesEn: z.array(z.string()),
  instructionsEn: z.array(z.string()),
})

async function translateOne(r: SeedRecipe): Promise<void> {
  const ingredientNames = r.ingredients.map((i) => i.name)
  const { object } = await generateObject({
    model: openai('gpt-5-mini'),
    schema: TranslationSchema,
    prompt: [
      'You are a professional Dutch to English culinary translator.',
      'Translate the following recipe from Dutch into natural English.',
      'Rules:',
      '- Translate the title, each ingredient NAME, and each how-to step.',
      '- Do NOT translate, add, or drop quantities or units (they are stored separately).',
      '- Keep the ingredient name list the SAME length and order as the input.',
      '- Keep the instruction step list the SAME length and order as the input.',
      '- Use common British/Irish English supermarket terms (e.g. "minced beef", "spring onion", "courgette", "aubergine").',
      '- Do NOT use em-dashes or en-dashes anywhere.',
      '',
      `Title (Dutch): ${r.title}`,
      '',
      `Ingredient names (Dutch), ${ingredientNames.length} items:`,
      JSON.stringify(ingredientNames),
      '',
      `Instruction steps (Dutch), ${r.instructions.length} steps:`,
      JSON.stringify(r.instructions),
    ].join('\n'),
  })

  // Re-attach qty/unit/productId from the Dutch lines; only `name` changes.
  // If the model returned a wrong-length name array, fall back per-index to the
  // Dutch name so an ingredient line is never dropped or misaligned.
  const ingredientsEn: Array<Ingredient> = r.ingredients.map((ing, idx) => {
    const en = object.ingredientNamesEn[idx]
    return { ...ing, name: hasText(en) ? en.trim() : ing.name }
  })

  const instructionsEn =
    object.instructionsEn.length === r.instructions.length
      ? object.instructionsEn.map((s) => s.trim())
      : r.instructions // length mismatch -> keep Dutch rather than misalign

  r.titleEn = object.titleEn.trim()
  r.ingredientsEn = ingredientsEn
  r.instructionsEn = instructionsEn
}

async function main() {
  const all = process.argv.includes('--all')
  const force = process.argv.includes('--force')

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      '[translate] OPENAI_API_KEY is not set. Aborting (no runtime fallback).',
    )
    process.exit(1)
  }

  const recipes = JSON.parse(readFileSync(DATA, 'utf8')) as Array<SeedRecipe>
  const target = recipes.filter((r) => (all ? true : isDemo(r)))
  const todo = target.filter((r) => force || !hasText(r.titleEn))

  console.log(
    `[translate] ${recipes.length} total, ${target.length} in scope (${all ? 'ALL' : 'demo set'}), ${todo.length} to translate${force ? ' (force)' : ''}.`,
  )
  if (todo.length === 0) {
    console.log('[translate] nothing to do (all in-scope recipes cached).')
    return
  }

  let done = 0
  let failed = 0
  // Simple bounded-concurrency worker pool over the queue.
  const queue = [...todo]
  async function worker(): Promise<void> {
    for (;;) {
      const r = queue.shift()
      if (!r) return
      try {
        await translateOne(r)
        done++
      } catch (err) {
        failed++
        console.error(`[translate] FAILED ${r.id}: ${(err as Error).message}`)
      }
      if ((done + failed) % 10 === 0 || done + failed === todo.length) {
        console.log(
          `[translate] ${done + failed}/${todo.length} (${failed} failed)`,
        )
        // Checkpoint to disk so a crash mid-run is resumable (cache by titleEn).
        writeFileSync(DATA, JSON.stringify(recipes, null, 2) + '\n')
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  )

  writeFileSync(DATA, JSON.stringify(recipes, null, 2) + '\n')
  console.log(
    `[translate] done. ${done} translated, ${failed} failed. Wrote ${DATA}.`,
  )
}

main()
