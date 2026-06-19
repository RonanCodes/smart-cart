/**
 * Embed the recipe catalogue into Cloudflare Vectorize (ADR-0001).
 *
 *   pnpm embed:recipes              # read recipes from remote D1, embed, upsert
 *   pnpm embed:recipes --from-seed  # read from data/seed/recipes.json instead
 *   pnpm embed:recipes --dry-run    # build + count vectors, do not upsert
 *
 * Why a script and not the in-Worker helper (src/lib/vectors/index.ts): that helper
 * binds to `cloudflare:workers` and only runs inside a deployed Worker. This build-time
 * job runs in plain Node, so it calls the same Workers AI model (`@cf/baai/bge-m3`,
 * 1024-dim, multilingual) and the Vectorize index over the Cloudflare REST API. The
 * embedding text is shared with the Worker via src/lib/vectors/recipe-text.ts so both
 * paths embed identical strings.
 *
 * Idempotent: vector id = recipe id and we upsert (not insert), so re-running replaces
 * each vector in place rather than duplicating. Vectorize counts unique ids.
 *
 * Needs a Cloudflare token with Vectorize:Edit + Workers AI:Edit (the deploy-only
 * Workers token fails with auth error 10000). Use the full-access personal token:
 *   export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_TOKEN_RONAN"
 *   export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID_RONAN"
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recipeText } from '../src/lib/vectors/recipe-text'

const INDEX = 'smart-cart-recipes'
const MODEL = '@cf/baai/bge-m3'
const EMBED_DIMS = 1024
/** Workers AI bge-m3 accepts a batch of texts per call. Keep batches modest. */
const EMBED_BATCH = 50
/** Vectorize accepts many vectors per upsert; chunk to keep request bodies sane. */
const UPSERT_BATCH = 200

interface Ingredient {
  name: string
}

interface CatalogueRecipe {
  id: string
  title: string
  cuisine: string | null
  ingredients: Array<Ingredient>
}

interface Args {
  fromSeed: boolean
  dryRun: boolean
}

function parseArgs(argv: Array<string>): Args {
  return {
    fromSeed: argv.includes('--from-seed'),
    dryRun: argv.includes('--dry-run'),
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing ${name}. Export the full-access personal Cloudflare token, e.g.\n` +
        `  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_TOKEN_RONAN"\n` +
        `  export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID_RONAN"`,
    )
  }
  return v
}

/** Coerce one raw recipe row into the shape we embed; tolerate JSON-string columns. */
function normalise(row: Record<string, unknown>): CatalogueRecipe | null {
  const id = typeof row.id === 'string' ? row.id : null
  const title = typeof row.title === 'string' ? row.title : null
  if (!id || !title) return null

  const cuisine = typeof row.cuisine === 'string' ? row.cuisine : null

  let ingredients: Array<Ingredient> = []
  const rawIng = row.ingredients
  const parsed =
    typeof rawIng === 'string'
      ? (JSON.parse(rawIng || '[]') as unknown)
      : rawIng
  if (Array.isArray(parsed)) {
    ingredients = parsed
      .map((i) =>
        i && typeof i === 'object' && typeof (i as Ingredient).name === 'string'
          ? { name: (i as Ingredient).name }
          : null,
      )
      .filter((i): i is Ingredient => i !== null)
  }

  return { id, title, cuisine, ingredients }
}

/** Read the catalogue from the local seed JSON. */
function readFromSeed(): Array<CatalogueRecipe> {
  const path = join(process.cwd(), 'data', 'seed', 'recipes.json')
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<
    Record<string, unknown>
  >
  return rows.map(normalise).filter((r): r is CatalogueRecipe => r !== null)
}

/** Read the catalogue from remote D1 via wrangler (JSON output). */
function readFromD1(): Array<CatalogueRecipe> {
  const sql = 'SELECT id, title, cuisine, ingredients FROM recipe;'
  const out = execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'smart_cart_db',
      '--remote',
      '--json',
      `--command=${sql}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  // wrangler may prepend banner lines; grab the JSON payload.
  const start = out.indexOf('[')
  const payload = JSON.parse(out.slice(start)) as Array<{
    results: Array<Record<string, unknown>>
  }>
  const results = payload[0]?.results ?? []
  return results.map(normalise).filter((r): r is CatalogueRecipe => r !== null)
}

async function cfFetch(
  path: string,
  accountId: string,
  token: string,
  body: BodyInit,
  contentType: string,
): Promise<unknown> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body,
    },
  )
  const json: {
    success: boolean
    errors: Array<{ message: string }>
    result: unknown
  } = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(
      `Cloudflare API ${path} failed: ${res.status} ${JSON.stringify(json.errors)}`,
    )
  }
  return json.result
}

/** Embed a batch of texts via Workers AI bge-m3 (REST). */
async function embedBatch(
  texts: Array<string>,
  accountId: string,
  token: string,
): Promise<Array<Array<number>>> {
  const result = (await cfFetch(
    `/ai/run/${MODEL}`,
    accountId,
    token,
    JSON.stringify({ text: texts }),
    'application/json',
  )) as { data: Array<Array<number>> }
  return result.data
}

/** Upsert a batch of vectors via the Vectorize v2 NDJSON endpoint. */
async function upsertBatch(
  vectors: Array<{
    id: string
    values: Array<number>
    metadata: Record<string, string>
  }>,
  accountId: string,
  token: string,
): Promise<void> {
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n') + '\n'
  await cfFetch(
    `/vectorize/v2/indexes/${INDEX}/upsert`,
    accountId,
    token,
    ndjson,
    'application/x-ndjson',
  )
}

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const recipes = args.fromSeed ? readFromSeed() : readFromD1()
  console.log(
    `Loaded ${recipes.length} recipes from ${args.fromSeed ? 'data/seed/recipes.json' : 'remote D1'}.`,
  )
  if (recipes.length === 0) {
    throw new Error('No recipes to embed. Seed the catalogue first.')
  }

  if (args.dryRun) {
    const first = recipes[0]
    console.log(`Dry run: would embed ${recipes.length} recipes.`)
    if (first) console.log(`Sample embedding text: ${recipeText(first)}`)
    return
  }

  const token = requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')

  // 1. Embed every recipe (batched calls to Workers AI).
  const embedded: Array<{
    id: string
    values: Array<number>
    metadata: Record<string, string>
  }> = []
  let done = 0
  for (const batch of chunk(recipes, EMBED_BATCH)) {
    const vectors = await embedBatch(
      batch.map((r) => recipeText(r)),
      accountId,
      token,
    )
    batch.forEach((r, i) => {
      const values = vectors[i]
      if (!values || values.length !== EMBED_DIMS) {
        throw new Error(
          `Bad embedding for ${r.id}: expected ${EMBED_DIMS} dims, got ${values?.length ?? 0}`,
        )
      }
      embedded.push({
        id: r.id,
        values,
        metadata: { cuisine: r.cuisine ?? 'unknown' },
      })
    })
    done += batch.length
    console.log(`Embedded ${done}/${recipes.length}`)
  }

  // 2. Upsert into Vectorize (batched NDJSON). Upsert => idempotent on recipe id.
  let upserted = 0
  for (const batch of chunk(embedded, UPSERT_BATCH)) {
    await upsertBatch(batch, accountId, token)
    upserted += batch.length
    console.log(`Upserted ${upserted}/${embedded.length}`)
  }

  console.log(
    `Done. Upserted ${upserted} vectors into ${INDEX}. Re-run is idempotent (upsert by recipe id).`,
  )
  console.log(
    `Verify with: pnpm exec wrangler vectorize info ${INDEX} (vectorCount is eventually consistent).`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
