/**
 * Embed the checkjebon product catalogue into Cloudflare Vectorize (ADR-0003).
 *
 *   pnpm embed:products            # embed every product, upsert into Vectorize
 *   pnpm embed:products --store=ah # only one store (faster for a demo)
 *   pnpm embed:products --dry-run  # build + count vectors, do not upsert
 *
 * Why a script and not the in-Worker helper (src/lib/pricing/product-vectors.ts):
 * that helper binds to `cloudflare:workers` and only runs inside a deployed
 * Worker. This build-time job runs in plain Node, calls the same Workers AI model
 * (`@cf/baai/bge-m3`, 1024-dim, multilingual) and the Vectorize index over the
 * Cloudflare REST API. The embedding text is shared with the Worker via
 * src/lib/pricing/product-text.ts so both paths embed identical strings.
 *
 * Idempotent: vector id = `${store}:${slug}` and we upsert, so re-running replaces
 * each vector in place rather than duplicating.
 *
 * ONE-TIME index setup (the query path filters by store, so `store` must be a
 * Vectorize metadata index):
 *   pnpm exec wrangler vectorize create smart-cart-products \
 *     --dimensions=1024 --metric=cosine
 *   pnpm exec wrangler vectorize create-metadata-index smart-cart-products \
 *     --property-name=store --type=string
 *
 * IMPORTANT: the committed checkjebon snapshot is trimmed to ~400 products/store.
 * For real matching coverage run `pnpm tsx scripts/sync-checkjebon.ts --full`
 * BEFORE embedding, or many ingredients will have no candidate to match.
 *
 * Needs a Cloudflare token with Vectorize:Edit + Workers AI:Edit:
 *   export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_TOKEN_RONAN"
 *   export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID_RONAN"
 */
import { getCatalogues } from '../src/lib/pricing/catalogue'
import {
  productVectorId,
  storeProductText,
} from '../src/lib/pricing/product-text'
import type { StoreProduct } from '../src/lib/pricing/types'

const INDEX = 'smart-cart-products'
const MODEL = '@cf/baai/bge-m3'
const EMBED_DIMS = 1024
const EMBED_BATCH = 50
const UPSERT_BATCH = 200

interface Args {
  store: string | null
  dryRun: boolean
}

function parseArgs(argv: Array<string>): Args {
  const storeArg = argv.find((a) => a.startsWith('--store='))
  return {
    store: storeArg ? storeArg.slice('--store='.length) : null,
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

/** Flatten the catalogues to the products we will embed (optionally one store). */
function collectProducts(store: string | null): Array<StoreProduct> {
  const catalogues = getCatalogues()
  const out: Array<StoreProduct> = []
  for (const cat of Object.values(catalogues)) {
    if (store && cat.store !== store) continue
    for (const p of cat.products) {
      if (p.slug) out.push(p) // need a slug for a stable vector id
    }
  }
  return out
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

  const products = collectProducts(args.store)
  console.log(
    `Loaded ${products.length} products${args.store ? ` for store '${args.store}'` : ''} from the vendored snapshot.`,
  )
  if (products.length === 0) {
    throw new Error(
      'No products to embed. Sync the snapshot (scripts/sync-checkjebon.ts) first.',
    )
  }

  if (args.dryRun) {
    const first = products[0]
    console.log(`Dry run: would embed ${products.length} products.`)
    if (first) console.log(`Sample embedding text: ${storeProductText(first)}`)
    return
  }

  const token = requireEnv('CLOUDFLARE_API_TOKEN')
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')

  const embedded: Array<{
    id: string
    values: Array<number>
    metadata: Record<string, string>
  }> = []
  let done = 0
  for (const batch of chunk(products, EMBED_BATCH)) {
    const vectors = await embedBatch(
      batch.map((p) => storeProductText(p)),
      accountId,
      token,
    )
    batch.forEach((p, i) => {
      const values = vectors[i]
      if (!values || values.length !== EMBED_DIMS) {
        throw new Error(
          `Bad embedding for ${p.store}:${p.slug}: expected ${EMBED_DIMS} dims, got ${values?.length ?? 0}`,
        )
      }
      embedded.push({
        id: productVectorId(p.store, p.slug),
        values,
        metadata: { store: p.store, name: p.name },
      })
    })
    done += batch.length
    console.log(`Embedded ${done}/${products.length}`)
  }

  let upserted = 0
  for (const batch of chunk(embedded, UPSERT_BATCH)) {
    await upsertBatch(batch, accountId, token)
    upserted += batch.length
    console.log(`Upserted ${upserted}/${embedded.length}`)
  }

  console.log(
    `Done. Upserted ${upserted} vectors into ${INDEX}. Re-run is idempotent (upsert by store:slug).`,
  )
  console.log(
    `Verify with: pnpm exec wrangler vectorize info ${INDEX} (vectorCount is eventually consistent).`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
