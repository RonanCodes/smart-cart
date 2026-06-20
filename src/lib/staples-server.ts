import { createServerFn } from '@tanstack/react-start'
import {
  getCataloguesFor,
  searchProducts,
  normaliseName,
  formatCents,
} from './pricing'
import type { ProductSearchHit } from './pricing'
import type { getDb } from '../db/client'

/** The drizzle db handle, named so the shared re-read avoids an inline import type. */
type Db = Awaited<ReturnType<typeof getDb>>

/**
 * Staples: non-recipe items (milk, coffee, toilet paper, snacks) the household
 * adds to the week's shopping list by searching the AH / Jumbo product
 * catalogue (#124, on top of the #59 pricing layer).
 *
 * Two halves, mirroring the waitlist/shopping split:
 *  - Pure glue (search-result shaping, productKey derivation, row -> list line,
 *    the frequently-bought set). Unit-tested without a DB or a network.
 *  - Server fns that wrap a D1 query around the glue.
 *
 * The stores we search/offer for the demo. AH + Jumbo are the two the PRD's
 * "Open in AH" / "Jumbo shown but stub" flow cares about.
 */
export const STAPLE_STORES = ['ah', 'jumbo'] as const

/** A search result shaped for the UI: a real product, its price, where from. */
export interface StapleSearchResult {
  /** Stable de-dupe key, sent back on add so the server need not re-derive it. */
  productKey: string
  name: string
  store: string
  /** Price in integer cents, or null when the snapshot had none. */
  priceCents: number | null
  /** Formatted price ('€1.29') or null. UI convenience so it never formats cents itself. */
  priceLabel: string | null
  /** The product slug/link, for deep-linking later. Null when none. */
  productSlug: string | null
  /** Pack size as free text from the snapshot ('1 l', 'ca. 700 g'), or null. */
  size: string | null
}

/** A staple already on the household's list, shaped for the shopping view. */
export interface StapleLine {
  id: string
  name: string
  store: string
  priceCents: number | null
  priceLabel: string | null
  productSlug: string | null
}

/**
 * Derive the stable de-dupe key for a product: store + slug when a slug exists,
 * else store + normalised name. Keeps "add the same staple twice" idempotent
 * without depending on a product id the snapshot does not have.
 */
export function deriveProductKey(
  store: string,
  slug: string | null,
  name: string,
): string {
  const tail = slug && slug.trim() ? slug.trim() : normaliseName(name)
  return `${store.toLowerCase()}:${tail}`
}

/** Map one pricing search hit to the UI result shape. */
export function hitToResult(hit: ProductSearchHit): StapleSearchResult {
  const p = hit.product
  const priceCents = Number.isFinite(p.priceCents) ? p.priceCents : null
  return {
    productKey: deriveProductKey(p.store, p.slug, p.name),
    name: p.name,
    store: p.store,
    priceCents,
    priceLabel: priceCents === null ? null : formatCents(priceCents),
    productSlug: p.slug,
    size: p.size.raw && p.size.raw.trim() ? p.size.raw : null,
  }
}

/**
 * Pure search: run the query against the given stores and shape the hits.
 * De-dupes by productKey so the same product from one store never appears twice.
 * Extracted so the server fn is thin and the ranking glue is unit-testable.
 */
export function searchStaplesPure(
  query: string,
  stores = STAPLE_STORES as ReadonlyArray<string>,
  limit = 8,
): Array<StapleSearchResult> {
  const catalogues = getCataloguesFor(stores)
  const hits = searchProducts(query, catalogues, { limit: limit * 2 })
  const seen = new Set<string>()
  const out: Array<StapleSearchResult> = []
  for (const hit of hits) {
    const result = hitToResult(hit)
    if (seen.has(result.productKey)) continue
    seen.add(result.productKey)
    out.push(result)
    if (out.length >= limit) break
  }
  return out
}

/**
 * The "frequently bought" quick-add row: a small fixed set of common staples
 * everyone tops up on. Each is a query, resolved live against the catalogue to a
 * real product (so the price is real), with a friendly label for the chip.
 * Anything that fails to resolve is dropped, so the row only ever shows
 * one-tap-addable items.
 */
const FREQUENT_QUERIES: ReadonlyArray<{ label: string; query: string }> = [
  { label: 'Milk', query: 'halfvolle melk' },
  { label: 'Eggs', query: 'eieren' },
  { label: 'Bread', query: 'brood' },
  { label: 'Coffee', query: 'koffie' },
  { label: 'Toilet paper', query: 'toiletpapier' },
  { label: 'Butter', query: 'roomboter' },
  { label: 'Bananas', query: 'bananen' },
  { label: 'Pasta', query: 'pasta' },
]

/** One frequently-bought chip: the friendly label plus the resolved product. */
export interface FrequentStaple {
  label: string
  result: StapleSearchResult
}

/**
 * Resolve the frequently-bought set to real products. Pure (catalogue is
 * vendored). Each query takes the single best match; unresolved queries drop out.
 */
export function frequentlyBoughtPure(
  stores = STAPLE_STORES as ReadonlyArray<string>,
): Array<FrequentStaple> {
  const out: Array<FrequentStaple> = []
  for (const { label, query } of FREQUENT_QUERIES) {
    const [top] = searchStaplesPure(query, stores, 1)
    if (top) out.push({ label, result: top })
  }
  return out
}

// --- Server fns ------------------------------------------------------------

/** Resolve the signed-in user's household id, or throw. Server-only. */
async function requireHouseholdId(): Promise<string> {
  const { getSessionUser } = await import('./server-auth')
  const user = await getSessionUser()
  if (!user) throw new Error('Not signed in')

  const { getDb } = await import('../db/client')
  const { household } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()
  const rows = await db
    .select({ id: household.id })
    .from(household)
    .where(eq(household.ownerId, user.id))
    .limit(1)
  const hh = rows[0]
  if (!hh) throw new Error('No household, onboard first')
  return hh.id
}

/** Search the AH / Jumbo catalogue for staples matching a free-text query. */
export const searchStaples = createServerFn({ method: 'GET' })
  .inputValidator((d: { query: unknown }) => ({ query: String(d.query ?? '') }))
  .handler(
    async ({ data }): Promise<{ results: Array<StapleSearchResult> }> => ({
      results: searchStaplesPure(data.query),
    }),
  )

/** The frequently-bought quick-add set, resolved to real products. */
export const frequentlyBoughtStaples = createServerFn({
  method: 'GET',
}).handler(
  async (): Promise<{ items: Array<FrequentStaple> }> => ({
    items: frequentlyBoughtPure(),
  }),
)

/** Map a persisted staple row to a shopping-view line. */
export function rowToLine(row: {
  id: string
  name: string
  store: string
  priceCents: number | null
  productSlug: string | null
}): StapleLine {
  return {
    id: row.id,
    name: row.name,
    store: row.store,
    priceCents: row.priceCents,
    priceLabel: row.priceCents === null ? null : formatCents(row.priceCents),
    productSlug: row.productSlug,
  }
}

/** Load the household's saved staples, newest first, shaped for the list. */
export const loadStaples = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ staples: Array<StapleLine> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const { staple } = await import('../db/staples-schema')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({
        id: staple.id,
        name: staple.name,
        store: staple.store,
        priceCents: staple.priceCents,
        productSlug: staple.productSlug,
      })
      .from(staple)
      .where(eq(staple.householdId, householdId))
      .orderBy(desc(staple.createdAt))
    return { staples: rows.map(rowToLine) }
  },
)

/**
 * Add a staple to the household's list. Idempotent on (household, productKey):
 * re-adding the same product is a no-op that keeps the first add. Returns the
 * refreshed list so the UI can re-render without a separate load.
 */
export const addStaple = createServerFn({ method: 'POST' })
  .inputValidator((d: StapleSearchResult) => d)
  .handler(async ({ data }): Promise<{ staples: Array<StapleLine> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const { staple } = await import('../db/staples-schema')
    const db = await getDb()
    await db
      .insert(staple)
      .values({
        id: crypto.randomUUID(),
        householdId,
        name: data.name,
        store: data.store,
        priceCents: data.priceCents,
        productSlug: data.productSlug,
        productKey: data.productKey,
      })
      .onConflictDoNothing({
        target: [staple.householdId, staple.productKey],
      })
    return reloadStaples(db, householdId)
  })

/** Remove a staple by id (scoped to the household so a stranger's id is inert). */
export const removeStaple = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }): Promise<{ staples: Array<StapleLine> }> => {
    const householdId = await requireHouseholdId()
    const { getDb } = await import('../db/client')
    const { staple } = await import('../db/staples-schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()
    await db
      .delete(staple)
      .where(and(eq(staple.id, data.id), eq(staple.householdId, householdId)))
    return reloadStaples(db, householdId)
  })

/** Shared re-read used by add/remove. */
async function reloadStaples(
  db: Db,
  householdId: string,
): Promise<{ staples: Array<StapleLine> }> {
  const { staple } = await import('../db/staples-schema')
  const { eq, desc } = await import('drizzle-orm')
  const rows = await db
    .select({
      id: staple.id,
      name: staple.name,
      store: staple.store,
      priceCents: staple.priceCents,
      productSlug: staple.productSlug,
    })
    .from(staple)
    .where(eq(staple.householdId, householdId))
    .orderBy(desc(staple.createdAt))
  return { staples: rows.map(rowToLine) }
}
