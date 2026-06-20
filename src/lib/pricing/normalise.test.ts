import { describe, expect, it } from 'vitest'
import {
  buildCatalogues,
  eurosToCents,
  normaliseName,
  parseSize,
} from './normalise'
import type { RawStore } from './types'

describe('parseSize', () => {
  it('parses a simple comma-decimal litre', () => {
    const s = parseSize('0,75 l')
    expect(s.quantity).toBe(0.75)
    expect(s.unit).toBe('l')
    expect(s.dimension).toBe('volume')
    expect(s.approx).toBe(false)
  })

  it('parses grams', () => {
    expect(parseSize('500 g')).toMatchObject({
      quantity: 500,
      unit: 'g',
      dimension: 'mass',
    })
  })

  it('parses kilograms with comma decimal', () => {
    expect(parseSize('1,55 kg')).toMatchObject({
      quantity: 1.55,
      unit: 'kg',
      dimension: 'mass',
    })
  })

  it('flags a "ca." approximate size and strips the prefix', () => {
    const s = parseSize('ca. 700 g')
    expect(s.approx).toBe(true)
    expect(s.quantity).toBe(700)
    expect(s.unit).toBe('g')
    expect(s.dimension).toBe('mass')
  })

  it('multiplies an "N x M unit" pack', () => {
    const s = parseSize('6 x 0,3 l')
    expect(s.quantity).toBe(1.8)
    expect(s.unit).toBe('l')
    expect(s.dimension).toBe('volume')
  })

  it('treats count units as the count dimension', () => {
    expect(parseSize('8 stuks')).toMatchObject({
      quantity: 8,
      unit: 'stuks',
      dimension: 'count',
    })
  })

  it('returns unknown for an empty size', () => {
    expect(parseSize('')).toMatchObject({
      quantity: null,
      unit: null,
      dimension: 'unknown',
    })
    expect(parseSize(undefined)).toMatchObject({ dimension: 'unknown' })
  })

  it('returns unknown dimension for an unrecognised unit but keeps the number', () => {
    const s = parseSize('5 mg')
    // mg is mapped to mass in the table
    expect(s.dimension).toBe('mass')
    const s2 = parseSize('200 wasbeurten')
    expect(s2.dimension).toBe('count')
    expect(s2.quantity).toBe(200)
  })
})

describe('normaliseName', () => {
  it('lower-cases, strips punctuation and collapses whitespace', () => {
    expect(normaliseName('AH  Penne, 500 g!')).toBe('ah penne 500 g')
  })

  it('strips accents', () => {
    expect(normaliseName('Crème fraîche')).toBe('creme fraiche')
  })
})

describe('eurosToCents', () => {
  it('rounds euros to integer cents', () => {
    expect(eurosToCents(8.99)).toBe(899)
    expect(eurosToCents(1)).toBe(100)
    expect(eurosToCents(0.1)).toBe(10)
  })

  it('rejects missing / negative / non-finite prices', () => {
    expect(eurosToCents(undefined)).toBeNull()
    expect(eurosToCents(-1)).toBeNull()
    expect(eurosToCents(Number.NaN)).toBeNull()
  })
})

describe('buildCatalogues', () => {
  const raw: Array<RawStore> = [
    {
      n: 'ah',
      c: 'Albert Heijn',
      u: 'https://www.ah.nl/producten/product/',
      d: [
        { n: 'AH Penne', l: 'wi1/ah-penne', p: 1.19, s: '500 g' },
        { n: 'Priceless thing', l: 'wi2/x', s: '1 l' }, // no price -> dropped
        { n: '', p: 2 }, // no name -> dropped
      ],
    },
    { n: 'aldi', c: 'Aldi', d: [] }, // empty store kept for honest coverage
  ]

  it('keys catalogues by lower-cased slug and keeps empty stores', () => {
    const cats = buildCatalogues(raw)
    expect(Object.keys(cats).sort()).toEqual(['ah', 'aldi'])
    expect(cats.aldi!.products).toHaveLength(0)
    expect(cats.aldi!.displayName).toBe('Aldi')
  })

  it('drops priceless and nameless products, never inventing a price', () => {
    const cats = buildCatalogues(raw)
    expect(cats.ah!.products).toHaveLength(1)
    const penne = cats.ah!.products[0]!
    expect(penne.name).toBe('AH Penne')
    expect(penne.priceCents).toBe(119)
    expect(penne.normalisedName).toBe('ah penne')
    expect(penne.size.dimension).toBe('mass')
    expect(cats.ah!.urlBase ?? '').toContain('ah.nl')
  })
})
