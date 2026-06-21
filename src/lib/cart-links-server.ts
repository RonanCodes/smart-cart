import { createServerFn } from '@tanstack/react-start'
import { buildAllItemsCartUrl } from './cart-build'
import type { BuiltCartLink } from './cart-build'
import type { StoreSlug } from './store-pref-server'

/**
 * Resolve the household's WHOLE shopping list, the week's recipe ingredients AND
 * the staples / extras, into ONE selected store's one-click bulk-cart deep-link
 * (#238).
 *
 * The store is the one the user picked in the selector (default = the household's
 * preferred store, #212). For the recipe lines we run the existing embedding
 * matcher (ADR-0004) against just that store's catalogue; the staples already
 * carry a saved store-specific slug, so a staple counts only when it was saved
 * for the SAME store the user is sending to. We extract the store SKU off each
 * resolved slug and hand the pairs to the pure URL builder in `./cart-build`.
 * Items that do not resolve are skipped, and matched-vs-total is returned so the
 * UI can say "(N of M items)".
 *
 * Decoupling (the second #238 bug): the build only ever resolves the SELECTED
 * store, so sending to Jumbo can never also fetch / fire AH. The old two-store
 * build (one server call resolving both) is gone.
 *
 * No store auth, no credentials, no new secrets: the deep-links are public URLs
 * the stores already honour. Server-only modules (DB, catalogue) are imported
 * INSIDE the handler so none of it leaks into the client bundle (the
 * shopping-list-server / staples-server pattern). Quantity defaults to 1 per
 * item: the shopping-list amount is free text ("450 g") and converting that to a
 * reliable pack count is out of scope, so we add one of each matched product.
 */

/** The resolved cart link for the one selected store. */
export type CartLinkResult = BuiltCartLink

/**
 * The live, client-supplied UNCHECKED set the page wants in the cart, so the
 * cart action reacts to ticks the user just made without waiting on the DB to
 * settle (#311). When omitted, the handler falls back to reading the household's
 * unchecked rows + saved staples straight from the DB.
 */
export interface CartLinksLiveSet {
  /** Recipe + manual item NAMES to resolve against the selected store. */
  itemNames: Array<string>
  /** Staple product SLUGS already saved for a store, with the store they belong to. */
  staples: Array<{ slug: string | null; store: string }>
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
 * Build ONE selected store's bulk-cart deep-link for the household's whole list:
 * the UNCHECKED recipe + manual items PLUS the saved staples for that store.
 * Already-ticked items are nothing left to buy, so they are excluded.
 */
export const buildCartLinks = createServerFn({ method: 'GET' })
  .inputValidator(
    (d: {
      store: unknown
      live?: unknown
    }): { store: StoreSlug; live: CartLinksLiveSet | null } => {
      const slug = String(d.store ?? '')
        .toLowerCase()
        .trim()
      if (slug !== 'ah' && slug !== 'jumbo') throw new Error('Unknown store')

      // The optional live set: validated defensively so a malformed payload
      // simply falls back to the DB read rather than throwing.
      let live: CartLinksLiveSet | null = null
      const raw = d.live as
        | { itemNames?: unknown; staples?: unknown }
        | undefined
        | null
      if (raw && typeof raw === 'object') {
        const itemNames = Array.isArray(raw.itemNames)
          ? raw.itemNames.map((n) => String(n)).filter((n) => n.trim() !== '')
          : []
        const staples = Array.isArray(raw.staples)
          ? raw.staples.map((s) => {
              const o = s as { slug?: unknown; store?: unknown }
              return {
                slug: o.slug == null ? null : String(o.slug),
                store: String(o.store ?? '')
                  .toLowerCase()
                  .trim(),
              }
            })
          : []
        live = { itemNames, staples }
      }
      return { store: slug, live }
    },
  )
  .handler(async ({ data }): Promise<CartLinkResult> => {
    const householdId = await requireHouseholdId()
    const store = data.store

    const { getDb } = await import('../db/client')
    const { shoppingListItem } = await import('../db/shopping-list-schema')
    const { staple } = await import('../db/staples-schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()

    let names: Array<string>
    let stapleRows: Array<{ slug: string | null }>

    if (data.live) {
      // Live (client-supplied) set: the unchecked items + staples exactly as the
      // page shows them right now, so a tick the user just made is honoured with
      // no DB round-trip lag. Staples are filtered to the SELECTED store, mirroring
      // the DB path (a staple saved for Jumbo never goes to AH's cart).
      names = data.live.itemNames
      stapleRows = data.live.staples
        .filter((s) => s.store === store)
        .map((s) => ({ slug: s.slug }))
    } else {
      // Fallback: read the household's still-to-buy items + saved staples from the
      // DB. The week + manual items: still-to-buy only. These need name -> product
      // resolution for the selected store.
      const itemRows = await db
        .select({ name: shoppingListItem.name })
        .from(shoppingListItem)
        .where(
          and(
            eq(shoppingListItem.householdId, householdId),
            eq(shoppingListItem.checked, false),
          ),
        )
      names = itemRows.map((r) => r.name)

      // The staples / extras: each already carries a saved store-specific slug, so
      // we take the ones saved for the SELECTED store directly (no re-matching).
      stapleRows = await db
        .select({ slug: staple.productSlug })
        .from(staple)
        .where(
          and(eq(staple.householdId, householdId), eq(staple.store, store)),
        )
    }

    // Semantic resolution (ADR-0004) for the recipe lines: embed each name once
    // for the selected store and take the nearest product by cosine, so
    // "mushroom" resolves to the Dutch champignon SKU with no synonym table.
    // Requires OPENAI_API_KEY; with no key it returns no matches (honest empty
    // cart) rather than the old token matcher.
    const { resolveLinesForStore } = await import('./pricing/resolve-lines')
    const resolved = await resolveLinesForStore(names, store)

    // One flat list of resolved slugs across BOTH sources (week + extras), so the
    // single cart link covers everything above the button on the page.
    const items = [
      ...resolved.map(({ match }) => ({ slug: match.product?.slug ?? null })),
      ...stapleRows.map((r) => ({ slug: r.slug })),
    ]

    return buildAllItemsCartUrl(store, items)
  })
