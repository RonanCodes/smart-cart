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
 * shopping-list-server / staples-server pattern). Pack count uses the same
 * pack-rounding as the price comparison so the AH cart total matches the UI.
 */

/** The resolved cart link for the one selected store. */
export type CartLinkResult = BuiltCartLink

/** One recipe / manual line sent live from the cart screen. */
export interface CartLinksLiveItem {
  name: string
  amount: string | null
}

/**
 * The live, client-supplied UNCHECKED set the page wants in the cart, so the
 * cart action reacts to ticks the user just made without waiting on the DB to
 * settle (#311). When omitted, the handler falls back to reading the household's
 * unchecked rows + saved staples straight from the DB.
 */
export interface CartLinksLiveSet {
  /** Recipe + manual lines to resolve against the selected store. */
  items: Array<CartLinksLiveItem>
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
export const buildCartLinks = createServerFn({ method: 'POST' })
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
        | { items?: unknown; itemNames?: unknown; staples?: unknown }
        | undefined
        | null
      if (raw && typeof raw === 'object') {
        let items: Array<CartLinksLiveItem> = []
        if (Array.isArray(raw.items)) {
          items = raw.items
            .map((row) => {
              const o = row as { name?: unknown; amount?: unknown }
              const name = String(o.name ?? '').trim()
              if (!name) return null
              return {
                name,
                amount:
                  o.amount == null || String(o.amount).trim() === ''
                    ? null
                    : String(o.amount),
              }
            })
            .filter((row): row is CartLinksLiveItem => row !== null)
        } else if (Array.isArray(raw.itemNames)) {
          items = raw.itemNames
            .map((n) => String(n).trim())
            .filter((n) => n !== '')
            .map((name) => ({ name, amount: null }))
        }
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
        live = { items, staples }
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

    let lines: Array<CartLinksLiveItem>
    let stapleRows: Array<{ slug: string | null }>

    if (data.live) {
      // Live (client-supplied) set: the unchecked items + staples exactly as the
      // page shows them right now, so a tick the user just made is honoured with
      // no DB round-trip lag. Staples are filtered to the SELECTED store, mirroring
      // the DB path (a staple saved for Jumbo never goes to AH's cart).
      lines = data.live.items
      stapleRows = data.live.staples
        .filter((s) => s.store === store)
        .map((s) => ({ slug: s.slug }))
    } else {
      // Fallback: read the household's still-to-buy items + saved staples from the
      // DB. The week + manual items: still-to-buy only. These need name -> product
      // resolution for the selected store.
      const itemRows = await db
        .select({
          name: shoppingListItem.name,
          amount: shoppingListItem.amount,
        })
        .from(shoppingListItem)
        .where(
          and(
            eq(shoppingListItem.householdId, householdId),
            eq(shoppingListItem.checked, false),
          ),
        )
      lines = itemRows.map((r) => ({ name: r.name, amount: r.amount }))

      // The staples / extras: each already carries a saved store-specific slug, so
      // we take the ones saved for the SELECTED store directly (no re-matching).
      stapleRows = await db
        .select({ slug: staple.productSlug })
        .from(staple)
        .where(
          and(eq(staple.householdId, householdId), eq(staple.store, store)),
        )
    }

    if (import.meta.env.DEV) {
      const { readEnv } = await import('./env')
      if (
        import.meta.env.VITE_PLAYWRIGHT_E2E_CART_LINKS === '1' ||
        (await readEnv('PLAYWRIGHT_E2E_CART_LINKS')) === '1'
      ) {
        const total = Math.max(lines.length + stapleRows.length, 1)
        const slug =
          store === 'ah'
            ? 'wi123456/e2e-albert-heijn-product'
            : 'e2e-jumbo-product-123456'
        return buildAllItemsCartUrl(
          store,
          Array.from({ length: total }, () => ({ slug, qty: 1 })),
        )
      }
    }

    const amountByName = new Map(lines.map((l) => [l.name, l.amount ?? null]))

    // Semantic resolution (ADR-0004): per line we try raw embedding retrieval,
    // accept only a very confident winner, otherwise expand to Dutch search terms
    // and LLM-rerank to pick the right SKU or decline.
    // Requires OPENAI_API_KEY; with no key it returns no matches (honest empty
    // cart) rather than the old token matcher.
    const { resolveLinesForStoreAccurate } =
      await import('./pricing/resolve-lines')
    const { packsForAmount } = await import('./pricing/basket')
    const resolved = await resolveLinesForStoreAccurate(lines, store)

    // One flat list of resolved slugs across BOTH sources (week + extras), so the
    // single cart link covers everything above the button on the page.
    const items = [
      ...resolved.map(({ name, match }) => ({
        slug: match.product?.slug ?? null,
        qty:
          match.product != null
            ? packsForAmount(amountByName.get(name), match.product)
            : undefined,
      })),
      ...stapleRows.map((r) => ({ slug: r.slug, qty: 1 })),
    ]

    return buildAllItemsCartUrl(store, items)
  })
