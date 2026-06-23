import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __clearMemoryCache,
  __setMemoryCacheForTest,
  matchCacheKey,
  resolveLinesForStoreCached,
} from './match-cache'
import { resolveLinesForStoreAccurate } from './resolve-lines'
import type { CartLineToResolve } from './resolve-lines'
import type { IngredientMatch } from './types'

vi.mock('./resolve-lines', () => ({
  resolveLinesForStoreAccurate: vi.fn(
    async (lines: ReadonlyArray<CartLineToResolve>, store) =>
      lines.map((l) => ({
        name: l.name,
        match: {
          store,
          product: null,
          priceCents: null,
          confidence: 'none' as const,
          estimated: true,
          score: 0,
        },
      })),
  ),
}))

/**
 * The cache is a read-through optimisation in front of resolveLinesForStoreAccurate.
 * In the test env there is no D1 binding and no embedding key, so:
 *  - the persistent (D1) read throws and is swallowed -> clean miss;
 *  - the accurate resolver, keyless, returns honest no-matches (ADR-0004).
 * The point of these tests is the cache's CONTRACT: never throw, always return one
 * result per input line in order, and degrade gracefully when the backends are
 * absent. (The accurate resolve itself is covered by resolve-lines / match-semantic.)
 */
describe('resolveLinesForStoreCached', () => {
  afterEach(() => {
    __clearMemoryCache()
    vi.mocked(resolveLinesForStoreAccurate).mockReset()
  })

  it('returns one result per input line, in order', async () => {
    const lines = [
      { name: 'broccoli', amount: '300 g' },
      { name: 'melk', amount: '1 l' },
    ]
    const out = await resolveLinesForStoreCached(lines, 'ah')
    expect(out.map((r) => r.name)).toEqual(['broccoli', 'melk'])
  })

  it('returns an empty array for an empty list (no backend touched)', async () => {
    expect(await resolveLinesForStoreCached([], 'ah')).toEqual([])
  })

  it('degrades to honest no-matches when backends are absent (never throws)', async () => {
    const out = await resolveLinesForStoreCached(
      [{ name: 'almond flour', amount: '200 g' }],
      'ah',
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.match.product).toBeNull()
    expect(out[0]!.match.confidence).toBe('none')
  })

  it('keys cache entries by amount so a name-only negative does not block', async () => {
    expect(matchCacheKey('ah', 'spaghetti', '1100 g')).toBe(
      'ah:spaghetti:1100 g',
    )
    expect(matchCacheKey('ah', 'spaghetti', null)).toBe('ah:spaghetti')

    __setMemoryCacheForTest('ah:spaghetti', {
      slug: null,
      confidence: 'none',
    })

    const freshMatch: IngredientMatch = {
      store: 'ah',
      product: {
        store: 'ah',
        name: 'AH Spaghetti vlugkokend',
        normalisedName: 'ah spaghetti vlugkokend',
        priceCents: 99,
        slug: 'wi543649/ah-spaghetti-vlugkokend',
        size: {
          raw: '500 g',
          quantity: 500,
          unit: 'g',
          dimension: 'mass',
          approx: false,
        },
      },
      priceCents: 99,
      confidence: 'high',
      estimated: false,
      score: 1,
    }
    vi.mocked(resolveLinesForStoreAccurate).mockResolvedValue([
      { name: 'spaghetti', match: freshMatch },
    ])

    const out = await resolveLinesForStoreCached(
      [{ name: 'spaghetti', amount: '1100 g' }],
      'ah',
    )

    expect(resolveLinesForStoreAccurate).toHaveBeenCalledOnce()
    expect(out[0]!.match.product?.slug).toBe('wi543649/ah-spaghetti-vlugkokend')
  })
})
