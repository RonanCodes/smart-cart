/**
 * Reseed remote D1 `recipe` table from data/seed/recipes.json, in batches.
 *
 *   pnpm reseed:d1            # apply to remote D1 in 200-row batches
 *   pnpm reseed:d1 --local    # apply to the local D1 instead
 *
 * Why a dedicated script and not seed-recipes.ts: that one reads data/recipes/*.json
 * (raw scraped dumps) and emits one giant SQL file applied in a single execute, which
 * stalls on a 1531-row catalogue. This reads the already-mapped seed JSON (the output
 * of import-recipes-db.ts) and applies INSERT OR REPLACE in chunks, printing progress
 * per batch so it never runs silently. Idempotent: id is the upsert key.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface SeedRecipe {
  id: string
  source: string
  sourceUrl: string | null
  title: string
  servings: number | null
  prepMinutes: number | null
  calories: number | null
  protein: number | null
  cuisine: string | null
  mealType: string
  category: string | null
  dietaryTags: Array<string>
  ingredients: Array<Record<string, unknown>>
  instructions: Array<string>
  /** English translations, present only for the translated demo set (#295). */
  titleEn?: string | null
  ingredientsEn?: Array<Record<string, unknown>> | null
  instructionsEn?: Array<string> | null
  [k: string]: unknown
}

const BATCH = 200

const q = (v: string) => `'${v.replace(/'/g, "''")}'`
const qjson = (v: unknown) => q(JSON.stringify(v ?? null))
const qnull = (v: string | number | null | undefined) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : q(v)

const COLS =
  'id, source, source_url, title, servings, prep_minutes, calories, protein, cuisine, meal_type, category, dietary_tags, ingredients, instructions, title_en, ingredients_en, instructions_en, raw, created_at'

/** JSON column that should be SQL NULL when absent (not the string "null"). */
const qjsonNull = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : q(JSON.stringify(v))

function rowValues(r: SeedRecipe, now: number): string {
  return [
    q(r.id),
    q(r.source),
    qnull(r.sourceUrl),
    q(r.title || 'Untitled'),
    qnull(r.servings),
    qnull(r.prepMinutes),
    qnull(r.calories),
    qnull(r.protein),
    qnull(r.cuisine),
    q(r.mealType || 'dinner'),
    qnull(r.category),
    qjson(r.dietaryTags),
    qjson(r.ingredients),
    qjson(r.instructions),
    qnull(r.titleEn ?? undefined),
    qjsonNull(r.ingredientsEn),
    qjsonNull(r.instructionsEn),
    qjson(r),
    String(now),
  ].join(', ')
}

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

function applyBatch(sql: string, local: boolean, tmp: string): void {
  const file = join(tmp, 'batch.sql')
  writeFileSync(file, sql)
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'smart_cart_db',
      local ? '--local' : '--remote',
      `--file=${file}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
}

function main() {
  const local = process.argv.includes('--local')
  const recipes = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', 'recipes.json'), 'utf8'),
  ) as Array<SeedRecipe>
  console.log(
    `[reseed] ${recipes.length} recipes -> ${local ? 'local' : 'remote'} D1, ${BATCH}/batch`,
  )

  const tmp = mkdtempSync(join(tmpdir(), 'smart-cart-reseed-'))
  try {
    const now = Math.floor(Date.now() / 1000)
    const batches = chunk(recipes, BATCH)
    let done = 0
    for (let b = 0; b < batches.length; b++) {
      const lines = batches[b]!.map(
        (r) =>
          `INSERT OR REPLACE INTO recipe (${COLS}) VALUES (${rowValues(r, now)});`,
      )
      applyBatch(lines.join('\n') + '\n', local, tmp)
      done += batches[b]!.length
      console.log(`[reseed] applied ${done}/${recipes.length}`)
    }
    console.log(`[reseed] done. ${recipes.length} recipes upserted.`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main()
