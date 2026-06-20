import { describe, it, expect } from 'vitest'
import { searchProducts } from './search'
import { buildCatalogues } from './normalise'
import type { StoreCatalogue, RawStore } from './types'

/** Build a small two-store catalogue set from terse raw input, like the real snapshot. */
function fixture(): Array<StoreCatalogue> {
  const raw: Array<RawStore> = [
    {
      n: 'ah',
      c: 'Albert Heijn',
      d: [
        { n: 'AH Halfvolle melk', l: 'wi1/melk-half', p: 1.19, s: '1 l' },
        { n: 'AH Volle melk', l: 'wi2/melk-vol', p: 1.29, s: '1 l' },
        { n: 'AH Koffiebonen', l: 'wi3/koffie', p: 4.99, s: '500 g' },
        { n: 'AH Toiletpapier 8 rollen', l: 'wi4/wc', p: 3.49, s: '8 rollen' },
        { n: 'AH Bananen', l: 'wi5/banaan', p: 1.79, s: 'ca. 700 g' },
      ],
    },
    {
      n: 'jumbo',
      c: 'Jumbo',
      d: [
        { n: 'Jumbo Halfvolle melk', l: 'j1/melk', p: 1.09, s: '1 l' },
        { n: 'Jumbo Koffie gemalen', l: 'j2/koffie', p: 3.99, s: '250 g' },
      ],
    },
  ]
  return Object.values(buildCatalogues(raw))
}

describe('searchProducts', () => {
  it('returns hits matching the query name across stores', () => {
    const hits = searchProducts('melk', fixture())
    expect(hits.length).toBeGreaterThan(0)
    expect(
      hits.every((h) => h.product.name.toLowerCase().includes('melk')),
    ).toBe(true)
  })

  it('ranks by score then cheapest on a tie', () => {
    const hits = searchProducts('melk', fixture())
    // All "X Halfvolle melk" / "X melk" share the same single-token recall, so
    // the cheapest melk (Jumbo at 1.09) should lead.
    expect(hits[0]?.product.priceCents).toBe(109)
  })

  it('respects the limit', () => {
    const hits = searchProducts('melk', fixture(), { limit: 1 })
    expect(hits).toHaveLength(1)
  })

  it('returns nothing for an empty or whitespace query', () => {
    expect(searchProducts('', fixture())).toEqual([])
    expect(searchProducts('   ', fixture())).toEqual([])
  })

  it('drops products below the floor (irrelevant query)', () => {
    const hits = searchProducts('xyzzy', fixture())
    expect(hits).toHaveLength(0)
  })

  it('matches a multi-word query like toilet paper via the Dutch product name', () => {
    const hits = searchProducts('toiletpapier', fixture())
    expect(hits[0]?.product.name).toContain('Toiletpapier')
  })

  it('carries a 0..1 score on every hit', () => {
    const hits = searchProducts('koffie', fixture())
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.score).toBeGreaterThan(0)
      expect(h.score).toBeLessThanOrEqual(1)
    }
  })
})
