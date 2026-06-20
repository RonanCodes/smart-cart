/**
 * Refresh the vendored checkjebon price snapshot.
 *
 *   pnpm tsx scripts/sync-checkjebon.ts            # trimmed snapshot (default)
 *   pnpm tsx scripts/sync-checkjebon.ts --full     # full ~10 MB file, untrimmed
 *
 * Fetches `data/supermarkets.json` from supermarkt/checkjebon (MIT, see
 * src/lib/pricing/data/NOTICE.md) and writes it under
 * src/lib/pricing/data/supermarkets.json. By default it trims each store to a
 * representative subset of common grocery products (keyword-filtered, capped)
 * so the committed file stays small; --full vendors the whole thing.
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

/** Per-store cap when trimming, and the common-grocery keywords to keep. */
const PER_STORE_CAP = 400
const KEEP_KEYWORDS = [
  'pasta',
  'penne',
  'spaghetti',
  'macaroni',
  'rijst',
  'rice',
  'melk',
  'milk',
  'kaas',
  'cheese',
  'boter',
  'butter',
  'ei ',
  'eieren',
  'egg',
  'kip',
  'chicken',
  'rund',
  'beef',
  'gehakt',
  'mince',
  'ui',
  'onion',
  'knoflook',
  'garlic',
  'tomaat',
  'tomato',
  'tomaten',
  'paprika',
  'pepper',
  'wortel',
  'carrot',
  'aardappel',
  'potato',
  'brood',
  'bread',
  'bloem',
  'flour',
  'suiker',
  'sugar',
  'zout',
  'salt',
  'olie',
  'oil',
  'olijfolie',
  'olive',
  'room',
  'cream',
  'yoghurt',
  'yogurt',
  'banaan',
  'banana',
  'appel',
  'apple',
  'sinaasappel',
  'orange',
  'komkommer',
  'cucumber',
  'sla',
  'lettuce',
  'spinazie',
  'spinach',
  'champignon',
  'mushroom',
  'courgette',
  'aubergine',
  'zalm',
  'salmon',
  'tonijn',
  'tuna',
  'garnaal',
  'prawn',
  'shrimp',
  'spek',
  'bacon',
  'worst',
  'sausage',
  'pesto',
  'passata',
  'bouillon',
  'stock',
  'azijn',
  'vinegar',
  'mosterd',
  'mustard',
  'honing',
  'honey',
  'kokosmelk',
  'coconut',
  'curry',
  'kerrie',
  'komijn',
  'cumin',
  'peterselie',
  'parsley',
  'basilicum',
  'basil',
  'citroen',
  'lemon',
  'limoen',
  'lime',
  'gember',
  'ginger',
  'bonen',
  'beans',
  'kikkererwten',
  'chickpea',
  'linzen',
  'lentil',
  'mais',
  'corn',
  'erwten',
  'peas',
  'broccoli',
  'bloemkool',
  'cauliflower',
  'prei',
  'leek',
  'selderij',
  'celery',
]

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

function trim(stores: Array<RawStore>): Array<RawStore> {
  const pattern = new RegExp(
    KEEP_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
      '|',
    ),
    'i',
  )
  return stores.map((store) => {
    const products = store.d ?? []
    const kept = products
      .filter((p) => pattern.test(p.n))
      .slice(0, PER_STORE_CAP)
    return { ...store, d: kept }
  })
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

  const output = full ? stores : trim(stores)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(output, null, 0))

  for (const store of output) {
    console.log(`  ${store.n}: ${(store.d ?? []).length} products`)
  }
  console.log(
    `[sync] wrote ${OUT} (${full ? 'full' : 'trimmed'}). Keep the MIT NOTICE.`,
  )
}

main().catch((e: unknown) => {
  console.error('[sync] failed:', e)
  process.exit(1)
})
