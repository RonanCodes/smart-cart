/**
 * Refresh the vendored checkjebon price snapshot.
 *
 *   pnpm tsx scripts/sync-checkjebon.ts            # AH + Jumbo, full assortment
 *   pnpm tsx scripts/sync-checkjebon.ts --full     # every store, untrimmed
 *
 * Fetches `data/supermarkets.json` from supermarkt/checkjebon (MIT, see
 * src/lib/pricing/data/NOTICE.md) and writes it under
 * src/lib/pricing/data/supermarkets.json.
 *
 * By default it keeps ONLY the supported stores (AH + Jumbo) but their FULL
 * assortment. There is deliberately no keyword allowlist: semantic matching
 * (ADR-0004) resolves an ingredient to the right SKU from the whole catalogue,
 * so pre-filtering by a hand-curated keyword list would just blind the matcher
 * to anything off-list (it is exactly what hid `AH Tarwebloem`). `--full`
 * vendors every store for ad-hoc price comparison.
 *
 * This is a refresh tool, not a request-path fetch. The app reads the committed
 * snapshot; it never calls GitHub at runtime. ToS caveat: scraped upstream data,
 * fine pre-revenue, revisit before commercial NL launch.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RAW_URL =
  'https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json'

const OUT = join(
  process.cwd(),
  'src',
  'lib',
  'pricing',
  'data',
  'supermarkets.json',
)

/** The supported stores ("AH/Jumbo first"). Others are dropped unless --full. */
const SUPPORTED_STORES = new Set(['ah', 'jumbo'])

interface RawProduct {
  n: string
  l?: string
  p?: number
  s?: string
}
interface RawStore {
  n: string
  d?: Array<RawProduct>
  u?: string
  c?: string
  i?: string
}

async function main() {
  const full = process.argv.includes('--full')
  console.log(`[sync] fetching ${RAW_URL}`)
  const res = await fetch(RAW_URL)
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText}`)
  }
  // tsc types res.json() as unknown here; the cast is required even though
  // eslint's program-level type info disagrees.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const stores = (await res.json()) as RawStore[]
  console.log(`[sync] got ${stores.length} stores`)

  const output = full
    ? stores
    : stores.filter((s) => SUPPORTED_STORES.has(s.n.toLowerCase()))

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(output, null, 0))

  for (const store of output) {
    console.log(`  ${store.n}: ${(store.d ?? []).length} products`)
  }
  console.log(
    `[sync] wrote ${OUT} (${full ? 'full' : 'AH + Jumbo, full assortment'}). Keep the MIT NOTICE.`,
  )
}

main().catch((e: unknown) => {
  console.error('[sync] failed:', e)
  process.exit(1)
})
