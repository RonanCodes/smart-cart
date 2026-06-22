/**
 * Resolved-match cache for the ACCURATE ingredient resolver (ADR-0004).
 *
 * The shopping-tab price comparison resolves lines with the accurate tier
 * (raw embedding fast path, then expand + multi-query retrieval + LLM rerank
 * only when ambiguous) so the displayed total exactly matches the basket
 * cart-build adds to Albert Heijn. Cache misses can still cost model calls and
 * run for every covered store on list changes / store switches. The name ->
 * product resolution is STABLE, so this module caches it.
 *
 * What is cached: the RESOLVED MATCH (store + normalised name -> product slug +
 * confidence), NOT the price. A cache hit rebuilds the IngredientMatch by looking
 * the slug up in the in-memory catalogue, so the price always comes fresh from the
 * catalogue. A genuine no-match is cached too (slug null) so we do not re-pay the
 * LLM cost to rediscover that an ingredient has no plausible product.
 *
 * Two tiers, both keyed on `<store>:<normalisedName>`:
 *
 *  1. PERSISTENT (D1 `match_cache` table): survives Worker cold starts and is
 *     shared across users. Read-through + write-on-miss. This is the durable win.
 *  2. IN-MEMORY (module-level bounded Map, cap ~2000): a per-Worker-instance hot
 *     cache in front of D1 so repeated resolutions within one instance (store
 *     switches, re-renders) skip even the D1 round-trip.
 *
 * Correctness + graceful degradation: every D1 read/write is wrapped so a cache
 * failure NEVER throws into the price comparison. A miss (or a DB error) falls
 * through to the real accurate resolve. The cache is purely an optimisation.
 */

import type { IngredientMatch, MatchConfidence } from './types'
import { normaliseName } from './normalise'
import { getCatalogue } from './catalogue'
import type { CartLineToResolve } from './resolve-lines'

/** Bound for the in-memory tier: cap entries so a long-lived Worker never grows
 * unboundedly. Insertion-order eviction (oldest key dropped first). */
const MEMORY_CACHE_CAP = 2000

/** A resolved match reduced to what we cache: the product slug (null = no
 * plausible match) plus the confidence band, so the rebuilt match keeps the
 * same soft/hard semantics. The price is NOT cached; it is read fresh. */
interface CachedResolution {
  slug: string | null
  confidence: MatchConfidence
}

/** Module-level in-memory tier. Map preserves insertion order, which we use for
 * cheap oldest-first eviction once it grows past the cap. */
const memory = new Map<string, CachedResolution>()

function cacheKey(store: string, normalisedName: string): string {
  return `${store}:${normalisedName}`
}

function memoryGet(key: string): CachedResolution | undefined {
  return memory.get(key)
}

function memorySet(key: string, value: CachedResolution): void {
  // Refresh recency: delete then re-insert so the key moves to the newest slot.
  if (memory.has(key)) memory.delete(key)
  memory.set(key, value)
  while (memory.size > MEMORY_CACHE_CAP) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

/** Visible for tests: empty the in-memory tier between cases. */
export function __clearMemoryCache(): void {
  memory.clear()
}

/**
 * Rebuild a full IngredientMatch from a cached resolution. The price + product
 * blob come fresh from the in-memory catalogue by slug, so a price change is
 * picked up without invalidating the cache. A cached negative (slug null), or a
 * slug that no longer exists in the catalogue, becomes an honest no-match.
 */
function rebuildMatch(
  store: string,
  cached: CachedResolution,
): IngredientMatch {
  const noMatch: IngredientMatch = {
    store,
    product: null,
    priceCents: null,
    confidence: 'none',
    estimated: true,
    score: 0,
  }
  if (cached.slug === null) return noMatch

  const catalogue = getCatalogue(store)
  const product = catalogue?.products.find((p) => p.slug === cached.slug)
  if (!product) return noMatch

  return {
    store,
    product,
    priceCents: product.priceCents,
    confidence: cached.confidence,
    estimated: cached.confidence !== 'high',
    // The score is not persisted (it is not load-bearing for the basket maths);
    // surface a representative value so a cached hit is not falsely "0".
    score: cached.confidence === 'high' ? 1 : 0,
  }
}

/** Reduce a freshly resolved match to the cacheable shape. */
function toCached(match: IngredientMatch): CachedResolution {
  return {
    slug: match.product?.slug ?? null,
    confidence: match.confidence,
  }
}

/* -------------------------------------------------------------------------- */
/* Persistent (D1) tier. Every op is wrapped: a failure degrades to a miss.   */
/* -------------------------------------------------------------------------- */

async function persistentGetMany(
  ids: ReadonlyArray<string>,
): Promise<Map<string, CachedResolution>> {
  const out = new Map<string, CachedResolution>()
  if (ids.length === 0) return out
  try {
    const { getDb } = await import('../../db/client')
    const { matchCache } = await import('../../db/match-cache-schema')
    const { inArray } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select()
      .from(matchCache)
      .where(inArray(matchCache.id, [...ids]))
    for (const row of rows) {
      out.set(row.id, {
        slug: row.slug,
        confidence: row.confidence as MatchConfidence,
      })
    }
  } catch {
    // Cache read failed (no DB binding in some contexts, transient error):
    // treat as a clean miss. The accurate resolver runs for these lines.
  }
  return out
}

async function persistentSetMany(
  store: string,
  entries: ReadonlyArray<{
    normalisedName: string
    resolution: CachedResolution
  }>,
): Promise<void> {
  if (entries.length === 0) return
  try {
    const { getDb } = await import('../../db/client')
    const { matchCache } = await import('../../db/match-cache-schema')
    const { sql } = await import('drizzle-orm')
    const db = await getDb()
    const now = new Date()
    const rows = entries.map((e) => ({
      id: cacheKey(store, e.normalisedName),
      store,
      normalisedName: e.normalisedName,
      slug: e.resolution.slug,
      confidence: e.resolution.confidence,
      createdAt: now,
    }))
    await db
      .insert(matchCache)
      .values(rows)
      .onConflictDoUpdate({
        target: matchCache.id,
        set: {
          slug: sql`excluded.slug`,
          confidence: sql`excluded.confidence`,
          createdAt: now,
        },
      })
  } catch {
    // Write-on-miss is best-effort: a failure just means the next resolve pays
    // the LLM cost again. Never propagate into the price comparison.
  }
}

/* -------------------------------------------------------------------------- */
/* The cache-aware accurate resolver.                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cache-aware wrapper around resolveLinesForStoreAccurate. For each line:
 *  - look it up in the in-memory tier, then the persistent (D1) tier;
 *  - on a hit, rebuild the match from the catalogue (fresh price), no LLM;
 *  - on a miss, batch the line through the real accurate resolver, then write
 *    the resolved match back to both tiers.
 *
 * A cache miss (or any cache error) always falls through to the real resolve, so
 * correctness is preserved: the cache only ever skips work it has proven before.
 * Returns matches in the SAME ORDER as the input lines (the basket builder keys
 * by name, but order is kept stable for callers that rely on it).
 */
export async function resolveLinesForStoreCached(
  lines: ReadonlyArray<CartLineToResolve>,
  store: string,
): Promise<Array<{ name: string; match: IngredientMatch }>> {
  if (lines.length === 0) return []

  // Pre-compute the normalised name + cache key per line (in input order).
  const keyed = lines.map((line) => {
    const normalised = normaliseName(line.name)
    return { line, normalised, key: cacheKey(store, normalised) }
  })

  // Tier 1: in-memory. Collect what is still unknown.
  const resolved = new Map<number, IngredientMatch>()
  const pendingIdx: Array<number> = []
  keyed.forEach((k, i) => {
    const hit = memoryGet(k.key)
    if (hit) resolved.set(i, rebuildMatch(store, hit))
    else pendingIdx.push(i)
  })

  // Tier 2: persistent D1, only for what memory missed.
  if (pendingIdx.length > 0) {
    const ids = pendingIdx.map((i) => keyed[i]!.key)
    const persisted = await persistentGetMany(ids)
    const stillPending: Array<number> = []
    for (const i of pendingIdx) {
      const k = keyed[i]!
      const hit = persisted.get(k.key)
      if (hit) {
        memorySet(k.key, hit) // warm the hot tier
        resolved.set(i, rebuildMatch(store, hit))
      } else {
        stillPending.push(i)
      }
    }

    // Tier 3: real accurate resolve for the genuine misses.
    if (stillPending.length > 0) {
      const { resolveLinesForStoreAccurate } = await import('./resolve-lines')
      const missLines = stillPending.map((i) => keyed[i]!.line)
      const freshMatches = await resolveLinesForStoreAccurate(missLines, store)
      // resolveLinesForStoreAccurate returns in input order; pair by index.
      const writes: Array<{
        normalisedName: string
        resolution: CachedResolution
      }> = []
      stillPending.forEach((i, j) => {
        const match = freshMatches[j]?.match
        if (!match) return
        resolved.set(i, match)
        const cached = toCached(match)
        const k = keyed[i]!
        memorySet(k.key, cached)
        writes.push({ normalisedName: k.normalised, resolution: cached })
      })
      // Write-on-miss to D1 (best-effort, fire-and-forget-safe via await).
      await persistentSetMany(store, writes)
    }
  }

  return keyed.map((k, i) => ({
    name: k.line.name,
    match: resolved.get(i) ?? {
      store,
      product: null,
      priceCents: null,
      confidence: 'none',
      estimated: true,
      score: 0,
    },
  }))
}
