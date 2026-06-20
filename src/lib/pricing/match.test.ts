import { describe, expect, it } from 'vitest'
import { buildCatalogues } from './normalise'
import {
  confidenceFromScore,
  contentTokens,
  matchIngredient,
  scoreMatch,
} from './match'
import type { RawStore, StoreCatalogue } from './types'

function store(products: Array<[string, number, string?]>): StoreCatalogue {
  const raw: Array<RawStore> = [
    {
      n: 'ah',
      c: 'Albert Heijn',
      d: products.map(([n, p, s]) => ({ n, p, s: s ?? '' })),
    },
  ]
  return buildCatalogues(raw).ah!
}

describe('contentTokens', () => {
  it('drops quantities, units and stop words', () => {
    expect(contentTokens('500g pasta')).toEqual(['pasta'])
    expect(contentTokens('2 cloves of garlic')).toEqual(['garlic'])
    expect(contentTokens('verse kipfilet')).toEqual(['kipfilet'])
  })
})

describe('scoreMatch', () => {
  it('scores a full token-overlap high', () => {
    const cat = store([['AH Penne pasta', 1.19, '500 g']])
    const score = scoreMatch(['pasta'], cat.products[0]!)
    expect(score).toBeGreaterThan(0.55)
  })

  it('gives a perfect-ish score to an exact name', () => {
    const cat = store([['pasta', 1.19]])
    expect(scoreMatch(['pasta'], cat.products[0]!)).toBe(1)
  })

  it('scores an unrelated product zero', () => {
    const cat = store([['Toiletpapier 8 rollen', 4.99]])
    expect(scoreMatch(['pasta'], cat.products[0]!)).toBe(0)
  })

  it('soft-matches a substring (kip inside kipfilet)', () => {
    const cat = store([['AH Kipfilet', 3.49]])
    expect(scoreMatch(['kip'], cat.products[0]!)).toBeGreaterThan(0)
  })
})

describe('confidenceFromScore', () => {
  it('bands scores', () => {
    expect(confidenceFromScore(0.9)).toBe('high')
    expect(confidenceFromScore(0.6)).toBe('medium')
    expect(confidenceFromScore(0.4)).toBe('low')
    expect(confidenceFromScore(0)).toBe('none')
  })
})

describe('matchIngredient', () => {
  it('matches an ingredient to the plausible product and reads its price', () => {
    const cat = store([
      ['AH Penne pasta', 1.19, '500 g'],
      ['AH Spaghetti', 0.89, '500 g'],
      ['Toiletpapier', 4.99],
    ])
    const m = matchIngredient('pasta', cat)
    expect(m.product?.name).toBe('AH Penne pasta')
    expect(m.priceCents).toBe(119)
    expect(m.confidence).not.toBe('none')
    expect(m.store).toBe('ah')
  })

  it('on a score tie, picks the cheapest product', () => {
    const cat = store([
      ['Melk', 1.29, '1 l'],
      ['Melk', 0.99, '1 l'],
    ])
    const m = matchIngredient('melk', cat)
    expect(m.priceCents).toBe(99)
  })

  it('returns a flagged no-match (never invents a price) when nothing fits', () => {
    const cat = store([['Toiletpapier 8 rollen', 4.99]])
    const m = matchIngredient('pasta', cat)
    expect(m.product).toBeNull()
    expect(m.priceCents).toBeNull()
    expect(m.confidence).toBe('none')
    expect(m.estimated).toBe(true)
    expect(m.score).toBe(0)
  })

  it('returns no-match against an empty store', () => {
    const empty = buildCatalogues([{ n: 'aldi', d: [] }]).aldi!
    expect(matchIngredient('pasta', empty).confidence).toBe('none')
  })

  it('flags a weak (non-high) match as estimated', () => {
    // partial overlap: "tomatensoep" vs ingredient "tomaat" -> soft match
    const cat = store([['Unox Tomatensoep blik', 1.49, '400 ml']])
    const m = matchIngredient('tomaat', cat)
    if (m.confidence !== 'none') {
      expect(m.estimated).toBe(m.confidence !== 'high')
    }
  })

  it('treats a high-confidence exact match as a real (non-estimated) price', () => {
    const cat = store([['pasta', 1.19, '500 g']])
    const m = matchIngredient('pasta', cat)
    expect(m.confidence).toBe('high')
    expect(m.estimated).toBe(false)
  })
})
