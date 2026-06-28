import { describe, expect, it } from 'vitest'
import { canonicalUnit, normaliseUnitToken, renderFromBase } from './units'

describe('normaliseUnitToken', () => {
  it('lowercases, trims, strips trailing dot', () => {
    expect(normaliseUnitToken(' Tbsp. ')).toBe('tbsp')
    expect(normaliseUnitToken('G')).toBe('g')
    expect(normaliseUnitToken(undefined)).toBe('')
  })
})

describe('canonicalUnit', () => {
  it('maps mass units to grams', () => {
    expect(canonicalUnit('kg')).toEqual({
      dimension: 'mass',
      toBase: 1000,
      base: 'g',
    })
    expect(canonicalUnit('grams').base).toBe('g')
    expect(canonicalUnit('mg').toBase).toBe(0.001)
  })

  it('maps volume units to millilitres', () => {
    expect(canonicalUnit('l')).toEqual({
      dimension: 'volume',
      toBase: 1000,
      base: 'ml',
    })
    expect(canonicalUnit('dl').toBase).toBe(100)
  })

  it('maps spoons to a tsp base (tbsp = 3 tsp)', () => {
    expect(canonicalUnit('tbsp')).toEqual({
      dimension: 'spoon',
      toBase: 3,
      base: 'tsp',
    })
    expect(canonicalUnit('teaspoon').base).toBe('tsp')
  })

  it('treats unknown units as a count dimension keyed on the singularised token', () => {
    expect(canonicalUnit('cloves')).toEqual({
      dimension: 'count',
      toBase: 1,
      base: 'teen',
    })
    expect(canonicalUnit('')).toEqual({
      dimension: 'count',
      toBase: 1,
      base: 'count',
    })
  })

  it('merges Dutch and English garlic-clove units onto one base', () => {
    expect(canonicalUnit('tenen').base).toBe('teen')
    expect(canonicalUnit('clove').base).toBe('teen')
    expect(canonicalUnit('stuks').base).toBe('stuk')
    expect(canonicalUnit('stuk').base).not.toBe(canonicalUnit('teen').base)
  })

  it('singularises so cloves and clove share a bucket but clove and can do not', () => {
    expect(canonicalUnit('cloves').base).toBe(canonicalUnit('clove').base)
    expect(canonicalUnit('clove').base).not.toBe(canonicalUnit('can').base)
  })
})

describe('renderFromBase', () => {
  it('promotes large masses to kg', () => {
    expect(renderFromBase('mass', 1500, 'g')).toEqual({
      value: 1.5,
      unit: 'kg',
    })
    expect(renderFromBase('mass', 450, 'g')).toEqual({ value: 450, unit: 'g' })
  })

  it('promotes large volumes to l', () => {
    expect(renderFromBase('volume', 2000, 'ml')).toEqual({
      value: 2,
      unit: 'l',
    })
  })

  it('renders whole tbsp multiples as tbsp, else tsp', () => {
    expect(renderFromBase('spoon', 6, 'tsp')).toEqual({
      value: 2,
      unit: 'tbsp',
    })
    expect(renderFromBase('spoon', 4, 'tsp')).toEqual({ value: 4, unit: 'tsp' })
  })

  it('renders the universal count bucket with no unit', () => {
    expect(renderFromBase('count', 3, 'count')).toEqual({ value: 3, unit: '' })
    expect(renderFromBase('count', 2, 'teen')).toEqual({
      value: 2,
      unit: 'tenen',
    })
    expect(renderFromBase('count', 1, 'teen')).toEqual({
      value: 1,
      unit: 'teen',
    })
  })

  it('rounds scaled counts up and masses to whole numbers (#367)', () => {
    expect(renderFromBase('count', 1.25, 'stuk')).toEqual({
      value: 2,
      unit: 'stuks',
    })
    expect(renderFromBase('mass', 93.75, 'g')).toEqual({ value: 94, unit: 'g' })
  })

  it('rounds scaled spoons up to whole tsp/tbsp (#367)', () => {
    // 2.1 tsp ceils to 3 tsp → promoted to 1 tbsp
    expect(renderFromBase('spoon', 2.1, 'tsp')).toEqual({
      value: 1,
      unit: 'tbsp',
    })
    expect(renderFromBase('spoon', 4.1, 'tsp')).toEqual({
      value: 5,
      unit: 'tsp',
    })
    expect(renderFromBase('spoon', 6, 'tsp')).toEqual({
      value: 2,
      unit: 'tbsp',
    })
  })
})
