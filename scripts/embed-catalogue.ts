/**
 * Build the embedding index for semantic matching (ADR-0004).
 *
 *   pnpm embed:catalogue            # embed recipes + products -> data/embeddings/
 *   pnpm embed:catalogue --dry-run  # count + sample text, no API calls, no write
 *
 * Embeds, with OpenAI text-embedding-3-small (256d):
 *   - AH + Jumbo recipes from data/seed/recipes.json, via the shared recipeText()
 *   - every checkjebon product from supermarkets.json (name + pack size)
 *
 * Writes committed base64 Float32 vectors to data/embeddings/{recipes,products}.json
 * plus a manifest. `pnpm seed` loads these into D1, so a fresh clone / CI seeds the
 * index with ZERO API calls. Re-run after sync-checkjebon or a recipe import.
 *
 * Needs OPENAI_API_KEY in the env. Locally:  set -a; source .dev.vars; set +a
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalogues } from '../src/lib/pricing/normalise'
import { storeProductId } from '../src/lib/pricing/store-product-rows'
import { recipeText } from '../src/lib/vectors/recipe-text'
import { embedQueries } from '../src/lib/embeddings/embed'
import { encodeVector } from '../src/lib/embeddings/codec'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_ENCODING,
  EMBEDDING_MODEL,
} from '../src/lib/embeddings/manifest'
import type { RawStore } from '../src/lib/pricing/types'
import { isDinnerRecipe } from '../src/lib/recipe-dinner'

const OUT_DIR = join(process.cwd(), 'data', 'embeddings')
/** OpenAI accepts a large batch per request; chunk for progress + safety. */
const BATCH = 1000
const RECIPE_SOURCES = new Set(['ah', 'jumbo'])

interface SeedRecipe {
  id: string
  source: string
  title: string
  cuisine: string | null
  ingredients?: Array<{ name?: unknown }>
}

interface Item {
  id: string
  text: string
  store?: string
}

function collectRecipes(): Array<Item> {
  const all = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', 'recipes.json'), 'utf8'),
  ) as Array<SeedRecipe>
  return all
    .filter((r) => RECIPE_SOURCES.has(r.source) && isDinnerRecipe(r))
    .map((r) => ({
      id: r.id,
      text: recipeText({
        title: r.title,
        cuisine: r.cuisine ?? null,
        ingredients: (r.ingredients ?? [])
          .map((i) => ({ name: typeof i.name === 'string' ? i.name : '' }))
          .filter((i) => i.name),
      }),
    }))
}

function collectProducts(): Array<Item> {
  const raw = JSON.parse(
    readFileSync(
      join(process.cwd(), 'src', 'lib', 'pricing', 'data', 'supermarkets.json'),
      'utf8',
    ),
  ) as Array<RawStore>
  const catalogues = buildCatalogues(raw)
  const out: Array<Item> = []
  for (const cat of Object.values(catalogues)) {
    for (const p of cat.products) {
      const size = p.size.raw.trim()
      out.push({
        id: storeProductId(p),
        store: p.store,
        text: size ? `${p.name} (${size})` : p.name,
      })
    }
  }
  // De-dupe by id (the catalogue can repeat a slug); last wins, matches the seeder.
  const byId = new Map(out.map((i) => [i.id, i]))
  return [...byId.values()]
}

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

async function embedAll(
  items: Array<Item>,
  label: string,
): Promise<Array<Item & { v: string }>> {
  const out: Array<Item & { v: string }> = []
  let done = 0
  for (const batch of chunk(items, BATCH)) {
    const vectors = await embedQueries(batch.map((i) => i.text))
    batch.forEach((item, i) => {
      const values = vectors[i]
      if (!values || values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Bad embedding for ${item.id}: expected ${EMBEDDING_DIMENSIONS} dims, got ${values?.length ?? 0}`,
        )
      }
      out.push({ ...item, v: encodeVector(values) })
    })
    done += batch.length
    console.log(`[embed] ${label} ${done}/${items.length}`)
  }
  return out
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const recipes = collectRecipes()
  const products = collectProducts()
  console.log(
    `[embed] ${recipes.length} recipes + ${products.length} products (model ${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS}d)`,
  )

  if (dryRun) {
    console.log(`[embed] dry run. sample recipe text: ${recipes[0]?.text}`)
    console.log(`[embed] sample product text: ${products[0]?.text}`)
    return
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY not set. Run: set -a; source .dev.vars; set +a; pnpm embed:catalogue',
    )
  }

  const recipeVecs = await embedAll(recipes, 'recipes')
  const productVecs = await embedAll(products, 'products')

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding: EMBEDDING_ENCODING,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'recipes.json'),
    JSON.stringify(recipeVecs.map((r) => ({ id: r.id, v: r.v }))) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'products.json'),
    JSON.stringify(
      productVecs.map((p) => ({ id: p.id, store: p.store, v: p.v })),
    ) + '\n',
  )
  console.log(
    `[embed] wrote data/embeddings/ (${recipeVecs.length} recipes, ${productVecs.length} products). Run pnpm seed to load into D1.`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
