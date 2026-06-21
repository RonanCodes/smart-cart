import { createServerFn } from '@tanstack/react-start'
import type { Locale } from './recipe-locale'

/**
 * Preferred-locale read/write for the Profile tab's "Language" row (#310).
 *
 * Recipe content is scraped in Dutch and translated to English at seed time
 * (#295). The household carries a `preferredLocale` ('en' | 'nl', default 'en')
 * that decides which the recipe-display surfaces show: 'en' shows the English
 * translation (Dutch fallback), 'nl' shows the Dutch source. This file is the
 * in-app entry to changing it after onboarding, mirroring store-pref-server so
 * the Profile diff stays isolated and the two settings rows behave identically.
 *
 * Two halves, like store-pref:
 *  - Pure glue (the locale catalogue + the slug guard), unit-tested with no DB.
 *  - createServerFns (getLocale / setLocale) that wrap D1 around the glue. All
 *    DB + auth access is behind dynamic import() inside the handler so nothing
 *    server-only leaks into the client bundle.
 *
 * App chrome / UI copy stays English in v1; only recipe CONTENT follows the
 * locale (full UI i18n is a follow-up).
 */

export type { Locale } from './recipe-locale'

export interface LocaleOption {
  /** Slug persisted on the household. */
  slug: Locale
  /** The control label, e.g. "English". */
  name: string
  /** The short segmented-control label, e.g. "EN". */
  short: string
  /** Flag glyph for a touch of warmth in the picker. */
  flag: string
}

/**
 * The two languages a household can pick, matching the onboarding language step
 * exactly so the two surfaces can't drift. English is the default; Dutch shows
 * the scraped originals.
 */
export const LOCALE_OPTIONS: ReadonlyArray<LocaleOption> = [
  { slug: 'en', name: 'English', short: 'EN', flag: '🇬🇧' },
  { slug: 'nl', name: 'Nederlands', short: 'NL', flag: '🇳🇱' },
]

/** The locale slugs we accept on a write. */
const REAL_LOCALES = new Set<Locale>(['en', 'nl'])

/**
 * Coerce arbitrary input to a known locale slug, or null if it isn't one we
 * accept. Pure: lowercases + trims, then gates against the locale set so a typo
 * / empty / unknown value never reaches the DB. Unit-tested without a DB.
 */
export function normalizeLocale(input: unknown): Locale | null {
  if (typeof input !== 'string') return null
  const slug = input.toLowerCase().trim()
  return REAL_LOCALES.has(slug as Locale) ? (slug as Locale) : null
}

/** The human label for a slug, for the row's trailing value. */
export function localeLabel(slug: Locale): string {
  return LOCALE_OPTIONS.find((o) => o.slug === slug)?.name ?? 'English'
}

/**
 * The signed-in household's current preferred locale. Defaults to 'en' (matching
 * the column default) when there's no household or no session, so every read
 * surface has a sensible value.
 */
export const getLocale = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Locale> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) return 'en'

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ preferredLocale: household.preferredLocale })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    return normalizeLocale(rows[0]?.preferredLocale) ?? 'en'
  },
)

/**
 * Persist the household's preferred locale. Validates the slug to a known locale
 * (rejecting junk) before touching the DB. Writes ONLY the preferredLocale
 * column, leaving the profile + everything else untouched, so this stays
 * isolated from the onboarding write path. Throws if not signed in or the user
 * hasn't onboarded (no household row to update).
 */
export const setLocale = createServerFn({ method: 'POST' })
  .inputValidator((d: { locale: string }) => {
    const slug = normalizeLocale(d.locale)
    if (!slug) throw new Error('Unknown locale')
    return { locale: slug }
  })
  .handler(async ({ data }): Promise<{ locale: Locale }> => {
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
      .set({ preferredLocale: data.locale, updatedAt: new Date() })
      .where(eq(household.id, householdId))

    return { locale: data.locale }
  })
