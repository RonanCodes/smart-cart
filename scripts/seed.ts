/**
 * Unified, reproducible D1 seeder for Smart Cart.
 *
 *   pnpm seed              # seed the LOCAL D1 (recipes + store products)
 *   pnpm seed --local      # same, explicit
 *   pnpm seed --remote     # seed the REMOTE D1 (deploy-time only; CF rate limits)
 *
 * Target a non-default D1 with D1_DB_NAME (e.g. the dev environment's database):
 *
 *   D1_DB_NAME=smart_cart_db_dev pnpm seed --remote
 *
 * Seeds BOTH halves of the catalogue so a fresh clone, CI, and prod all hold the
 * same data:
 *
 *   1. Recipes  -- AH + Jumbo only (source IN ('ah','jumbo')) from
 *      data/seed/recipes.json, INSERT OR REPLACE in batches (the reseed-d1
 *      pattern: a single giant execute stalls on a 1500-row catalogue). The
 *      foodcom / themealdb rows are intentionally NOT seeded; only AH/Jumbo
 *      recipes ever surface as cards (src/db/recipe-filters.ts).
 *   2. Store products -- the vendored checkjebon snapshot
 *      (src/lib/pricing/data/supermarkets.json) normalised via buildCatalogues
 *      and upserted into the `store_product` table. Additive: the in-memory
 *      pricing path (src/lib/pricing/*) still reads the bundled JSON; this is a
 *      queryable D1 copy, not a replacement.
 *
 * Idempotent: both halves upsert on a stable primary key, so re-running is safe.
 * `pnpm reseed:d1` still works (recipe-only, all sources) for ad-hoc use; this
 * is the canonical seeder wired into `npm run init` and CI.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCatalogues } from '../src/lib/pricing/normalise'
import { toStoreProductRows } from '../src/lib/pricing/store-product-rows'
import type { RawStore } from '../src/lib/pricing/types'

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
  [k: string]: unknown
}

const BATCH = 200
/** Only these recipe sources surface as cards; seed only them. */
const RECIPE_SOURCES = new Set(['ah', 'jumbo'])

const q = (v: string) => `'${v.replace(/'/g, "''")}'`
const qjson = (v: unknown) => q(JSON.stringify(v ?? null))
const qnull = (v: string | number | null | undefined) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : q(v)

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

/**
 * D1 database to seed. Defaults to the prod database name; override with
 * `D1_DB_NAME=smart_cart_db_dev pnpm seed --remote` to seed the dev D1 (so a
 * freshly stood-up dev environment can be populated from the same data).
 */
const DB_NAME = process.env.D1_DB_NAME ?? 'smart_cart_db'

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
      DB_NAME,
      local ? '--local' : '--remote',
      `--file=${file}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
}

// ---- recipes ---------------------------------------------------------------

const RECIPE_COLS =
  'id, source, source_url, title, servings, prep_minutes, calories, protein, cuisine, meal_type, category, dietary_tags, ingredients, instructions, raw, created_at'

function recipeValues(r: SeedRecipe, now: number): string {
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
    qjson(r),
    String(now),
  ].join(', ')
}

function seedRecipes(local: boolean, tmp: string, now: number): void {
  const all = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', 'recipes.json'), 'utf8'),
  ) as Array<SeedRecipe>
  const recipes = all.filter((r) => RECIPE_SOURCES.has(r.source))
  console.log(
    `[seed] recipes: ${recipes.length}/${all.length} (AH+Jumbo) -> ${local ? 'local' : 'remote'} D1, ${BATCH}/batch`,
  )
  const batches = chunk(recipes, BATCH)
  let done = 0
  for (const batch of batches) {
    const lines = batch.map(
      (r) =>
        `INSERT OR REPLACE INTO recipe (${RECIPE_COLS}) VALUES (${recipeValues(r, now)});`,
    )
    applyBatch(lines.join('\n') + '\n', local, tmp)
    done += batch.length
    console.log(`[seed] recipes applied ${done}/${recipes.length}`)
  }
}

// ---- store products --------------------------------------------------------

const PRODUCT_COLS = 'id, store, slug, name, price_cents, unit, raw, created_at'

function seedStoreProducts(local: boolean, tmp: string, now: number): void {
  const raw = JSON.parse(
    readFileSync(
      join(process.cwd(), 'src', 'lib', 'pricing', 'data', 'supermarkets.json'),
      'utf8',
    ),
  ) as Array<RawStore>
  const catalogues = buildCatalogues(raw)
  const products = Object.values(catalogues).flatMap((c) => c.products)
  const rows = toStoreProductRows(products)
  console.log(
    `[seed] store products: ${rows.length} rows -> ${local ? 'local' : 'remote'} D1, ${BATCH}/batch`,
  )
  const batches = chunk(rows, BATCH)
  let done = 0
  for (const batch of batches) {
    const lines = batch.map(
      (row) =>
        `INSERT OR REPLACE INTO store_product (${PRODUCT_COLS}) VALUES (${[
          q(row.id),
          q(row.store),
          qnull(row.slug),
          q(row.name),
          qnull(row.priceCents),
          qnull(row.unit),
          qjson(row.raw),
          String(now),
        ].join(', ')});`,
    )
    applyBatch(lines.join('\n') + '\n', local, tmp)
    done += batch.length
    console.log(`[seed] store products applied ${done}/${rows.length}`)
  }
}

// ---- embeddings (ADR-0004) -------------------------------------------------

const EMBED_DIR = join(process.cwd(), 'data', 'embeddings')

interface EmbeddingManifestFile {
  model: string
  dimensions: number
}

/**
 * Load the committed embedding index (data/embeddings/*) into D1: a base64 vector
 * onto each store_product row, and one recipe_embedding row per recipe. Skipped
 * with a notice when the index has not been built yet (pnpm embed:catalogue), so
 * a clone without an OpenAI key still seeds the rest of the catalogue.
 */
function seedEmbeddings(local: boolean, tmp: string, now: number): void {
  const manifestPath = join(EMBED_DIR, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.log(
      '[seed] embeddings: data/embeddings/ not found, skipping. Run pnpm embed:catalogue to build it.',
    )
    return
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as EmbeddingManifestFile

  const products = JSON.parse(
    readFileSync(join(EMBED_DIR, 'products.json'), 'utf8'),
  ) as Array<{ id: string; v: string }>
  console.log(
    `[seed] product embeddings: ${products.length} rows -> ${local ? 'local' : 'remote'} D1, ${BATCH}/batch`,
  )
  let pdone = 0
  for (const batch of chunk(products, BATCH)) {
    const lines = batch.map(
      (p) =>
        `UPDATE store_product SET embedding = ${q(p.v)} WHERE id = ${q(p.id)};`,
    )
    applyBatch(lines.join('\n') + '\n', local, tmp)
    pdone += batch.length
    console.log(`[seed] product embeddings applied ${pdone}/${products.length}`)
  }

  const recipes = JSON.parse(
    readFileSync(join(EMBED_DIR, 'recipes.json'), 'utf8'),
  ) as Array<{ id: string; v: string }>
  console.log(
    `[seed] recipe embeddings: ${recipes.length} rows -> ${local ? 'local' : 'remote'} D1, ${BATCH}/batch`,
  )
  let rdone = 0
  for (const batch of chunk(recipes, BATCH)) {
    const lines = batch.map(
      (r) =>
        `INSERT OR REPLACE INTO recipe_embedding (recipe_id, embedding, model, dims, created_at) VALUES (${q(r.id)}, ${q(r.v)}, ${q(manifest.model)}, ${manifest.dimensions}, ${now});`,
    )
    applyBatch(lines.join('\n') + '\n', local, tmp)
    rdone += batch.length
    console.log(`[seed] recipe embeddings applied ${rdone}/${recipes.length}`)
  }
}

function main(): void {
  const remote = process.argv.includes('--remote')
  const local = !remote
  console.log(`[seed] target: ${local ? 'local' : 'remote'} D1`)

  const tmp = mkdtempSync(join(tmpdir(), 'smart-cart-seed-'))
  try {
    const now = Math.floor(Date.now() / 1000)
    seedRecipes(local, tmp, now)
    seedStoreProducts(local, tmp, now)
    seedEmbeddings(local, tmp, now)
    console.log('[seed] done. recipes + store products + embeddings upserted.')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main()
