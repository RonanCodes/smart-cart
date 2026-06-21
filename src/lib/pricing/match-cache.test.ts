import { afterEach, describe, expect, it } from 'vitest'
import { __clearMemoryCache, resolveLinesForStoreCached } from './match-cache'

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
  afterEach(() => __clearMemoryCache())

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
})
