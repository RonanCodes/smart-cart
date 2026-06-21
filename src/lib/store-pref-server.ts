import { createServerFn } from '@tanstack/react-start'

/**
 * Preferred-store read/write for the Profile tab's "Preferred store" row (#212).
 *
 * The onboarding Store step (#109) captures the same field on the household
 * (`preferredStore`, slug 'ah' | 'jumbo' | 'picnic'; see onboarding-mapping).
 * This file is the in-app entry to changing it AFTER onboarding, deliberately
 * kept separate from onboarding-server so the Profile diff stays isolated.
 *
 * Two halves, mirroring the tip/staples split:
 *  - Pure glue (the store catalogue + the slug guard), unit-tested with no DB.
 *  - createServerFns (getStore / setStore) that wrap D1 around the glue. All DB
 *    + auth access is behind dynamic import() inside the handler so nothing
 *    server-only leaks into the client bundle.
 */

/**
 * The store slugs a household can pick as its preferred store. The slug union
 * keeps 'jumbo' so its pricing + cart plumbing stays intact for when we turn it
 * back on; the UI just gates it as "Coming soon" for now (see COMING_SOON_STORES
 * + effectiveStore). The price-comparison cart only deep-links AH + Jumbo today;
 * building Picnic's cart is tracked separately (#293).
 */
export type StoreSlug = 'ah' | 'jumbo' | 'picnic'

export interface StoreOption {
  /** Slug persisted on the household. */
  slug: StoreSlug
  name: string
  /** Brand initials shown in the colour chip when there's no logo. */
  initials: string
  /** Tailwind classes for the brand chip (background + text). */
  chipClassName: string
  /**
   * Path to the self-hosted brand logo under public/brand/stores/, shown in
   * place of the initials chip when present. Never hotlinked.
   */
  iconSrc?: string
  /**
   * When true the store shows as a disabled "Coming soon" option: visible in the
   * selectors but not pickable, and never the effective cart/pricing store. Used
   * to park Jumbo until it's tested, without ripping out its plumbing.
   */
  comingSoon?: boolean
}

/**
 * The three Dutch stores, matching the onboarding Store step exactly so the two
 * surfaces can't drift. All three are selectable preferences; Picnic shows its
 * real brand logo, the others keep their brand-colour initials chip.
 */
export const STORE_OPTIONS: ReadonlyArray<StoreOption> = [
  {
    slug: 'ah',
    name: 'Albert Heijn',
    initials: 'AH',
    chipClassName: 'bg-[#00ade6] text-white',
  },
  {
    slug: 'jumbo',
    name: 'Jumbo',
    initials: 'J',
    chipClassName: 'bg-[#eab90c] text-black',
    // Parked until Jumbo pricing + cart are tested. Shown disabled with a
    // "Coming soon" tag; never selectable, never the effective store.
    comingSoon: true,
  },
  {
    slug: 'picnic',
    name: 'Picnic',
    initials: 'P',
    chipClassName: 'bg-[#e1141d] text-white',
    iconSrc: '/brand/stores/picnic.png',
  },
]

/** The store slugs we accept on a write. */
const REAL_STORES = new Set<StoreSlug>(['ah', 'jumbo', 'picnic'])

/** The default store every fallback lands on. */
export const DEFAULT_STORE: StoreSlug = 'ah'

/** Slugs that are parked as "Coming soon": valid values, but not pickable and
 *  never the effective cart/pricing store. Derived from STORE_OPTIONS so the
 *  flag is the single source of truth. */
const COMING_SOON_STORES = new Set<StoreSlug>(
  STORE_OPTIONS.filter((o) => o.comingSoon).map((o) => o.slug),
)

/** Whether a store is currently selectable (not a "Coming soon" option). */
export function isStoreSelectable(slug: StoreSlug): boolean {
  return !COMING_SOON_STORES.has(slug)
}

/**
 * Coerce arbitrary input to a known store slug, or null if it isn't one we
 * accept. Pure: lowercases + trims, then gates against the store set so a typo
 * / empty / unknown value never reaches the DB. Unit-tested without a DB.
 *
 * Note: this still accepts 'jumbo' as a VALID slug so existing data + the
 * pricing plumbing keep working. Use effectiveStore to gate what the cart /
 * pricing actually run against.
 */
export function normalizeStore(input: unknown): StoreSlug | null {
  if (typeof input !== 'string') return null
  const slug = input.toLowerCase().trim()
  return REAL_STORES.has(slug as StoreSlug) ? (slug as StoreSlug) : null
}

/**
 * The store the cart + pricing should actually run against. Coerces any parked
 * "Coming soon" slug (Jumbo, for now) down to the default store, so an existing
 * household whose saved preference is 'jumbo' still gets a working AH cart
 * instead of landing on an untested store. Selectable slugs pass through
 * untouched.
 */
export function effectiveStore(slug: StoreSlug): StoreSlug {
  return COMING_SOON_STORES.has(slug) ? DEFAULT_STORE : slug
}

/** The human label for a slug, for the row's trailing value. */
export function storeLabel(slug: StoreSlug): string {
  return STORE_OPTIONS.find((o) => o.slug === slug)?.name ?? 'Albert Heijn'
}

/**
 * The signed-in household's current preferred store slug. Defaults to 'ah'
 * (matching the column default) when there's no household or no session, so the
 * Profile row always has a sensible value to show.
 */
export const getStore = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StoreSlug> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) return 'ah'

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ preferredStore: household.preferredStore })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    // Coerce any parked "Coming soon" slug (e.g. a saved 'jumbo') down to the
    // default so the cart + pricing always run against a real, tested store.
    const saved = normalizeStore(rows[0]?.preferredStore) ?? DEFAULT_STORE
    return effectiveStore(saved)
  },
)

/** Everything the /profile route's loader needs, in one round-trip (#251). */
export interface ProfileBootstrap {
  isAdmin: boolean
  store: StoreSlug
}

/**
 * The /profile loader, batched into ONE round-trip (#251). The route's local
 * loadProfile() used to call isAdmin() + getStore() as two separate GET server
 * fns; this composes the same two reads INSIDE one server handler so the client
 * makes a single call. Behaviour and shape are unchanged, so the route's existing
 * useQuery seeding (initialData = loader result) keeps working untouched.
 */
export const loadProfileBootstrap = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ProfileBootstrap> => {
    const { isAdmin } = await import('./admin-server')
    const [admin, store] = await Promise.all([isAdmin(), getStore()])
    return { isAdmin: admin, store }
  },
)

/**
 * Persist the household's preferred store. Validates the slug to a known store
 * (rejecting junk) before touching the DB. Writes ONLY the
 * preferredStore column, leaving the profile + everything else untouched, so
 * this stays isolated from the onboarding write path. Throws if not signed in
 * or the user hasn't onboarded (no household row to update).
 */
export const setStore = createServerFn({ method: 'POST' })
  .inputValidator((d: { store: string }) => {
    const slug = normalizeStore(d.store)
    if (!slug) throw new Error('Unknown store')
    // A parked "Coming soon" store (e.g. Jumbo) is a valid slug but must never
    // be persisted as a preference while it's gated in the UI.
    if (!isStoreSelectable(slug)) throw new Error('Store not available yet')
    return { store: slug }
  })
  .handler(async ({ data }): Promise<{ store: StoreSlug }> => {
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
    const householdId = rows[0]?.id
    if (!householdId) throw new Error('No household, onboard first')

    await db
      .update(household)
      .set({ preferredStore: data.store, updatedAt: new Date() })
      .where(eq(household.id, householdId))

    return { store: data.store }
  })
