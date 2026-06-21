import type { CalaSource } from './cala'

/** One Discover-feed card: a titled, source-cited idea from Cala. */
export interface DiscoverCard {
  /** Stable angle id ('in-season', 'nutrition', 'cuisine', 'fun-fact'). */
  id: string
  /** Short human title we generate from the angle ('In season now'). */
  title: string
  /** The markdown answer Cala returned (treat as untrusted web content). */
  content: string
  /** Citations backing the card, each with a name + url. */
  sources: Array<CalaSource>
}

/**
 * The household fields the feed personalizes on. A narrow structural slice of
 * `household.profile` so the query builder stays pure + unit-testable and never
 * imports the drizzle schema. Everything is optional: a sparse profile just
 * yields fewer angles.
 */
export interface DiscoverProfile {
  /** Cuisines the household explicitly likes (form onboarding). */
  cuisinesLiked?: Array<string>
  /** Legacy swipe-derived loves (cuisines + ingredients), the fallback. */
  lovedTastes?: Array<string>
  /** Disliked ingredients — NEVER named in a query. */
  dislikes?: Array<string>
  /** Disliked cuisines — avoided as a spotlight angle. */
  dislikedCuisines?: Array<string>
  /** Diet label ('vegetarian', 'pescatarian', ...) when set. */
  diet?: string
}

/** One planned Cala query: the angle id, its card title, and the question. */
export interface DiscoverAngle {
  id: string
  title: string
  query: string
}

/** Dutch month names index by 0-11 month, for the seasonal angle. */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Title-case a token for display / weaving into prose ('italian' -> 'Italian'). */
function titleCase(s: string): string {
  const t = s.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/**
 * Pick the household's "loved cuisines" for the spotlight angles. Prefers the
 * explicit form list (`cuisinesLiked`); falls back to the legacy swipe-derived
 * `lovedTastes`. Drops anything that also appears in their disliked-cuisines list
 * (a contradiction) and de-dupes case-insensitively, keeping first-seen order.
 */
export function lovedCuisines(profile: DiscoverProfile): Array<string> {
  const disliked = new Set(
    (profile.dislikedCuisines ?? []).map((c) => c.trim().toLowerCase()),
  )
  const source =
    profile.cuisinesLiked && profile.cuisinesLiked.length
      ? profile.cuisinesLiked
      : (profile.lovedTastes ?? [])
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const raw of source) {
    const key = raw.trim().toLowerCase()
    if (!key || disliked.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(titleCase(raw))
  }
  return out
}

/**
 * A negative clause that tells Cala to avoid the household's disliked ingredients,
 * so we never surface an idea built around something they hate. Empty string when
 * there's nothing to avoid (keeps the question clean).
 */
export function avoidClause(profile: DiscoverProfile): string {
  const dislikes = (profile.dislikes ?? []).map((d) => d.trim()).filter(Boolean)
  if (!dislikes.length) return ''
  return ` Avoid anything involving ${dislikes.join(', ')}.`
}

/**
 * Build the personalized set of Cala angles for a household, given the current
 * month (0-11; the caller passes `new Date().getMonth()` from a server handler).
 * Pure, so the angle selection + query wording is unit-testable without a clock
 * or a network. Returns up to ~4-5 angles, skipping any that the profile can't
 * support (e.g. no loved cuisine -> no cuisine spotlight). Disliked ingredients
 * are never named in a query and are explicitly excluded via `avoidClause`.
 */
export function buildDiscoverAngles(
  profile: DiscoverProfile,
  month: number,
): Array<DiscoverAngle> {
  const avoid = avoidClause(profile)
  const loves = lovedCuisines(profile)
  const monthName = MONTHS[month] ?? MONTHS[0]
  const angles: Array<DiscoverAngle> = []

  // 1. In season now (NL) — always included, no personalization needed beyond
  // dodging disliked ingredients.
  angles.push({
    id: 'in-season',
    title: 'In season now',
    query:
      `What fruits and vegetables are in season in the Netherlands in ` +
      `${monthName}? Give three or four with a short reason each on why ` +
      `they're good right now. Be concise.${avoid}`,
  })

  // 2. Health / nutrition — tied to their diet, else their top loved cuisine,
  // else a general healthy-eating angle.
  const nutritionFocus = profile.diet?.trim()
    ? `a ${profile.diet.trim()} diet`
    : loves[0]
      ? `${loves[0]} cooking`
      : 'everyday home cooking'
  angles.push({
    id: 'nutrition',
    title: 'Good to know',
    query:
      `Give one interesting, verifiable nutrition fact relevant to ` +
      `${nutritionFocus}. Keep it to two short sentences.${avoid}`,
  })

  // 3. Cuisine spotlight — only if we know a cuisine they love.
  if (loves[0]) {
    angles.push({
      id: 'cuisine',
      title: `${loves[0]} spotlight`,
      query:
        `Tell me about a notable ${loves[0]} weeknight dinner dish and one or ` +
        `two interesting, verifiable facts about it. Be concise.${avoid}`,
    })
  }

  // 4. Fun food fact — tied to a second loved cuisine/ingredient when we have
  // one, else a general kitchen-science angle. Always included so the feed has
  // at least three cards even for a sparse profile.
  const funFocus = loves[1]
    ? `${loves[1]} food`
    : loves[0]
      ? `${loves[0]} food`
      : 'a common kitchen ingredient'
  angles.push({
    id: 'fun-fact',
    title: 'Did you know?',
    query:
      `Share one surprising but verifiable fun fact about ${funFocus}. ` +
      `Keep it to one or two short sentences.${avoid}`,
  })

  return angles
}

/** How long a cached feed stays fresh before we regenerate it (24h, in ms). */
export const DISCOVER_TTL_MS = 24 * 60 * 60 * 1000

/** Parse the stored cards JSON, tolerating anything malformed (-> empty). */
export function parseCards(json: string): Array<DiscoverCard> {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (c): c is DiscoverCard =>
        !!c &&
        typeof c.id === 'string' &&
        typeof c.title === 'string' &&
        typeof c.content === 'string' &&
        Array.isArray(c.sources),
    )
  } catch {
    return []
  }
}

/**
 * The Discover feed for a household, source-cited via Cala (cala.ai). A plain
 * function (no Start context) so it is unit-testable directly; the createServerFn
 * in discover-server.ts is a thin wrapper that dynamically imports this.
 *
 * This module is SERVER-ONLY (it dynamic-imports db/client, which statically
 * pulls `cloudflare:workers`). It must never be imported, even for types, by a
 * client component, or that binding leaks into the browser bundle and the build
 * fails resolving `cloudflare:workers`. Components import only the thin server fn.
 *
 * Cache-first: a fresh row (younger than `DISCOVER_TTL_MS`) in `discover_cards`
 * is served without spending Cala credits. On a miss (or stale, or `force`), we
 * read the household profile, build the personalized angles, ask Cala each in
 * PARALLEL (a full feed is several credits), assemble the cards, cache the feed,
 * and return it. Gated on `CALA_API_KEY`: when the key is unset (or every query
 * errors / returns nothing), we return `[]` so the feed hides cleanly.
 */
export async function fetchDiscoverCards(args: {
  /** Force regenerate, ignoring a fresh cache row (the refresh affordance). */
  force?: boolean
  /** Override "now" for tests; defaults to the real clock in a server handler. */
  now?: Date
}): Promise<Array<DiscoverCard>> {
  const now = args.now ?? new Date()

  const { getSessionUser } = await import('./server-auth')
  const user = await getSessionUser()
  if (!user) return []

  const { getDb } = await import('../db/client')
  const { household } = await import('../db/schema')
  const { discoverCards } = await import('../db/discover-cards-schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.ownerId, user.id))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) return []

  // Cache-first: serve a fresh stored feed without touching Cala (credit budget).
  if (!args.force) {
    const cached = (
      await db
        .select({
          cardsJson: discoverCards.cardsJson,
          generatedAt: discoverCards.generatedAt,
        })
        .from(discoverCards)
        .where(eq(discoverCards.householdId, hh.id))
        .limit(1)
    )[0]
    if (cached) {
      const age = now.getTime() - cached.generatedAt.getTime()
      if (age < DISCOVER_TTL_MS) return parseCards(cached.cardsJson)
    }
  }

  // Cache miss / stale / forced. Need a key to ask Cala; without one, hide.
  const { readEnv } = await import('./env')
  const apiKey = (await readEnv('CALA_API_KEY'))?.trim()
  if (!apiKey) return []

  // profile is NOT NULL (defaults to {}); cast the structural slice the builder needs.
  const profile = hh.profile as DiscoverProfile
  const angles = buildDiscoverAngles(profile, now.getMonth())

  const { calaSearch } = await import('./cala')
  // Fan out in parallel — a feed is several credits, but one round-trip of
  // latency. Each angle degrades independently: a failed/empty query is dropped
  // rather than failing the whole feed.
  const settled = await Promise.allSettled(
    angles.map((a) => calaSearch(a.query, apiKey)),
  )
  const cards: Array<DiscoverCard> = []
  settled.forEach((res, i) => {
    const angle = angles[i]
    if (!angle || res.status !== 'fulfilled') return
    const content = res.value.content.trim()
    if (!content) return
    cards.push({
      id: angle.id,
      title: angle.title,
      content,
      sources: res.value.sources,
    })
  })

  // Every query failed / empty: return [] without caching, so the next visit
  // retries rather than caching an empty feed.
  if (!cards.length) return []

  // Cache the assembled feed (upsert: regenerate replaces the prior row).
  try {
    await db
      .insert(discoverCards)
      .values({
        householdId: hh.id,
        cardsJson: JSON.stringify(cards),
        generatedAt: now,
      })
      .onConflictDoUpdate({
        target: discoverCards.householdId,
        set: { cardsJson: JSON.stringify(cards), generatedAt: now },
      })
  } catch {
    // Caching is best-effort; a failed write just means we regenerate next time.
  }

  return cards
}
