import { createServerFn } from '@tanstack/react-start'
import { storeVisible } from './flags'
import type { FlagSet } from './flags'

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
 * The store slugs a household can pick as its preferred store. Which of the
 * three are actually selectable / orderable is now decided at runtime by the
 * feature flags (lib/flags.ts: `store.<slug>.visible` / `.ordering`), read from
 * D1 per environment, so a store can be turned on in dev without touching prod.
 * `effectiveStore` coerces a saved-but-now-hidden slug to a visible one.
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

/** Every store slug, in display order, for the visible-store fallback. */
const ALL_STORES: ReadonlyArray<StoreSlug> = ['ah', 'jumbo', 'picnic']

/**
 * Coerce arbitrary input to a known store slug, or null if it isn't one we
 * accept. Pure: lowercases + trims, then gates against the store set so a typo
 * / empty / unknown value never reaches the DB. Unit-tested without a DB.
 *
 * Accepts all three slugs as VALID values regardless of their flag state, so
 * existing data + the pricing plumbing keep working. Use effectiveStore to gate
 * what the cart / pricing actually run against.
 */
export function normalizeStore(input: unknown): StoreSlug | null {
  if (typeof input !== 'string') return null
  const slug = input.toLowerCase().trim()
  return REAL_STORES.has(slug as StoreSlug) ? (slug as StoreSlug) : null
}

/**
 * The store the cart + pricing should actually run against, given the live
 * flags. A saved slug whose `visible` flag is off (e.g. a household saved
 * 'jumbo' while Jumbo is parked) coerces to the first VISIBLE store so the
 * switch, pricing and order bar never land on a hidden store; falls back to the
 * default ('ah') if somehow nothing is visible. A visible slug passes through
 * untouched. Pure (flags passed in), so it's unit-testable and usable on both
 * the server (getStore) and the client (the /shopping route's initial store).
 */
export function effectiveStore(slug: StoreSlug, flags: FlagSet): StoreSlug {
  if (storeVisible(flags, slug)) return slug
  return ALL_STORES.find((s) => storeVisible(flags, s)) ?? DEFAULT_STORE
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
    // Coerce a saved-but-now-hidden slug (e.g. a saved 'jumbo' while Jumbo's
    // visible flag is off) to a visible store so the cart + pricing always run
    // against a store the user can actually use.
    const { readFlags } = await import('./flags-read')
    const flags = await readFlags()
    const saved = normalizeStore(rows[0]?.preferredStore) ?? DEFAULT_STORE
    return effectiveStore(saved, flags)
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
    return { store: slug }
  })
  .handler(async ({ data }): Promise<{ store: StoreSlug }> => {
    // A hidden store (its `visible` flag off) is a valid slug but must never be
    // persisted as a preference. Checked here (not the sync validator) because
    // resolving the flags is an async D1 read.
    const { readFlags } = await import('./flags-read')
    const flags = await readFlags()
    if (!storeVisible(flags, data.store))
      throw new Error('Store not available yet')

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
