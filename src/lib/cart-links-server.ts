import { createServerFn } from '@tanstack/react-start'

/**
 * Resolve the household's shopping list into one-click AH + Jumbo cart
 * deep-links.
 *
 * For each persisted shopping-list item we resolve that item's AH and Jumbo
 * product, pull the store SKU off the matched product's slug, and hand the
 * {sku, qty} pairs to the pure URL builders in `./cart-links`. Items we cannot
 * place in a store are skipped, and the count of matched-vs-skipped is returned
 * so the UI can say "(N of M items)".
 *
 * Resolution order (#165): we PREFER the persisted `store_product` D1 link (the
 * seeded, queryable catalogue copy) and FALL BACK to the existing in-memory
 * matcher (matchIngredient against the bundled checkjebon catalogue) for any
 * item D1 cannot place. The bundled path is unchanged, so nothing regresses if
 * D1 is empty (a fresh clone before `pnpm seed`) -- every item simply takes the
 * runtime fallback exactly as before.
 *
 * No store auth, no credentials, no new secrets: the deep-links are public URLs
 * the stores already honour. Server-only modules (DB, catalogue) are imported
 * INSIDE the handler so none of it leaks into the client bundle (the
 * shopping-list-server / staples-server pattern). Quantity defaults to 1 per
 * item: the shopping-list amount is free text ("450 g") and converting that to a
 * reliable pack count is out of scope, so we add one of each matched product.
 */

/** A single store's resolved cart link plus its match stats. */
export interface StoreCartLink {
  /** The store slug ('ah' | 'jumbo'). */
  store: string
  /** Human display name ('Albert Heijn' / 'Jumbo'). */
  displayName: string
  /** The bulk-cart deep-link, or null when nothing on the list matched. */
  url: string | null
  /** How many list items resolved to a SKU in this store. */
  matched: number
  /** The total number of list items considered (excludes already-ticked). */
  total: number
}

/** The resolved cart links for both stores. */
export interface CartLinksResult {
  ah: StoreCartLink
  jumbo: StoreCartLink
}

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

/**
 * Build the AH + Jumbo bulk-cart deep-links for the household's UNCHECKED
 * shopping-list items (already-ticked items are nothing left to buy).
 */
export const buildCartLinks = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CartLinksResult> => {
    const householdId = await requireHouseholdId()

    const { getDb } = await import('../db/client')
    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ name: shoppingListItem.name })
      .from(shoppingListItem)
      .where(
        and(
          eq(shoppingListItem.householdId, householdId),
          eq(shoppingListItem.checked, false),
        ),
      )

    const names = rows.map((r) => r.name)

    const { getCatalogue } = await import('./pricing')
    const { matchIngredient } = await import('./pricing')
    const { ahProductId, jumboSku, ahBulkCartUrl, jumboBulkCartUrl } =
      await import('./cart-links')
    const { resolveIngredientsToProducts } =
      await import('./store-product-server')

    const ahCat = getCatalogue('ah')
    const jumboCat = getCatalogue('jumbo')

    // Prefer the persisted D1 product link; index it by (store, name) so the
    // per-item loop can look up the D1 slug before reaching for the bundled
    // matcher. A D1 outage / empty table leaves this map empty and every item
    // falls back to the runtime matcher (no regression).
    const d1Slug = new Map<string, string>()
    try {
      const resolved = await resolveIngredientsToProducts(names, [
        'ah',
        'jumbo',
      ])
      for (const line of resolved) {
        const slug = line.match.product?.slug
        if (slug) d1Slug.set(`${line.store}:${line.name}`, slug)
      }
    } catch {
      // store_product not seeded / unavailable: fall back to bundled matcher.
    }

    /** Resolve one item's slug for a store: D1 first, bundled matcher fallback. */
    function slugFor(name: string, store: 'ah' | 'jumbo'): string | null {
      const fromD1 = d1Slug.get(`${store}:${name}`)
      if (fromD1) return fromD1
      const cat = store === 'ah' ? ahCat : jumboCat
      if (!cat) return null
      return matchIngredient(name, cat).product?.slug ?? null
    }

    const ahItems: Array<{ sku: string; qty: number }> = []
    const jumboItems: Array<{ sku: string; qty: number }> = []

    for (const name of names) {
      const ahId = ahProductId(slugFor(name, 'ah'))
      if (ahId) ahItems.push({ sku: ahId, qty: 1 })
      const jSku = jumboSku(slugFor(name, 'jumbo'))
      if (jSku) jumboItems.push({ sku: jSku, qty: 1 })
    }

    return {
      ah: {
        store: 'ah',
        displayName: 'Albert Heijn',
        url: ahBulkCartUrl(ahItems),
        matched: ahItems.length,
        total: names.length,
      },
      jumbo: {
        store: 'jumbo',
        displayName: 'Jumbo',
        url: jumboBulkCartUrl(jumboItems),
        matched: jumboItems.length,
        total: names.length,
      },
    }
  },
)
