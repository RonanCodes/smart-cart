import { createServerFn } from '@tanstack/react-start'

/**
 * Preferred-store read/write for the Profile tab's "Preferred store" row (#212).
 *
 * The onboarding Store step (#109) captures the same field on the household
 * (`preferredStore`, slug 'ah' | 'jumbo'; see onboarding-mapping). This file is
 * the in-app entry to changing it AFTER onboarding, deliberately kept separate
 * from onboarding-server so the Profile diff stays isolated.
 *
 * Two halves, mirroring the tip/staples split:
 *  - Pure glue (the store catalogue + the slug guard), unit-tested with no DB.
 *  - createServerFns (getStore / setStore) that wrap D1 around the glue. All DB
 *    + auth access is behind dynamic import() inside the handler so nothing
 *    server-only leaks into the client bundle.
 */

/** The store slugs we actually fulfil a basket against. Picnic is the joke. */
export type StoreSlug = 'ah' | 'jumbo'

export interface StoreOption {
  /** Slug persisted on the household, or null for the coming-soon joke entry. */
  slug: StoreSlug | null
  name: string
  /** Brand initials shown in the colour chip in lieu of a logo. */
  initials: string
  /** Tailwind classes for the brand chip (background + text). */
  chipClassName: string
  /** Picnic is shown disabled with the CTO joke; it never persists. */
  comingSoon?: boolean
}

/**
 * The three Dutch stores, matching the onboarding Store step exactly so the two
 * surfaces can't drift. Albert Heijn + Jumbo are selectable; Picnic is the
 * in-joke (the Picnic CTO is a megathon judge) and stays disabled.
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
  },
  {
    slug: null,
    name: 'Picnic',
    initials: 'P',
    chipClassName: 'bg-[#e1141d] text-white',
    comingSoon: true,
  },
]

/** The Picnic in-joke copy, shared with the onboarding Store step. */
export const PICNIC_JOKE = 'Coming soon if we can convince the CTO'

/** The store slugs we accept on a write. */
const REAL_STORES = new Set<StoreSlug>(['ah', 'jumbo'])

/**
 * Coerce arbitrary input to a known store slug, or null if it isn't one we
 * fulfil. Pure: lowercases + trims, then gates against the real-store set so a
 * Picnic / typo / empty value never reaches the DB. Unit-tested without a DB.
 */
export function normalizeStore(input: unknown): StoreSlug | null {
  if (typeof input !== 'string') return null
  const slug = input.toLowerCase().trim()
  return REAL_STORES.has(slug as StoreSlug) ? (slug as StoreSlug) : null
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
    return normalizeStore(rows[0]?.preferredStore) ?? 'ah'
  },
)

/**
 * Persist the household's preferred store. Validates the slug to a real store
 * (rejecting Picnic / junk) before touching the DB. Writes ONLY the
 * preferredStore column, leaving the profile + everything else untouched, so
 * this stays isolated from the onboarding write path. Throws if not signed in
 * or the user hasn't onboarded (no household row to update).
 */
export const setStore = createServerFn({ method: 'POST' })
  .inputValidator((d: { store: string }) => {
    const slug = normalizeStore(d.store)
    if (!slug) throw new Error('Unknown store')
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
