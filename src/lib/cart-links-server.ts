import { createServerFn } from '@tanstack/react-start'

/**
 * Resolve the household's shopping list into one-click AH + Jumbo cart
 * deep-links.
 *
 * For each persisted shopping-list item we resolve that item's AH and Jumbo
 * product D1-first (the seeded `store_product` table via
 * `resolveIngredientForStore`), falling back to the runtime bundled checkjebon
 * catalogue when D1 has no match, pull the store SKU off the matched product's
 * slug, and hand the {sku, qty} pairs to the pure URL builders in
 * `./cart-links`. Items neither catalogue can place in a store are skipped, and
 * the count of matched-vs-skipped is returned so the UI can say "(N of M items)".
 *
 * The D1-first resolution is the #165 persisted recipe -> ingredient -> product
 * link; the bundle fallback keeps the cart working on a fresh clone that has not
 * seeded `store_product`, so this is purely additive (no regression).
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

    const { resolveIngredientForStore } =
      await import('./pricing/ingredient-resolver-server')
    const { ahProductId, jumboSku, ahBulkCartUrl, jumboBulkCartUrl } =
      await import('./cart-links')

    const ahItems: Array<{ sku: string; qty: number }> = []
    const jumboItems: Array<{ sku: string; qty: number }> = []

    for (const name of names) {
      // D1-first (seeded store_product), bundled-catalogue fallback inside.
      const ah = await resolveIngredientForStore(name, 'ah')
      const id = ahProductId(ah.match.product?.slug)
      if (id) ahItems.push({ sku: id, qty: 1 })

      const jumbo = await resolveIngredientForStore(name, 'jumbo')
      const sku = jumboSku(jumbo.match.product?.slug)
      if (sku) jumboItems.push({ sku, qty: 1 })
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
