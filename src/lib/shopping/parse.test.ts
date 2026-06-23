import { describe, expect, it } from 'vitest'
import { parseQty, splitQtyAndUnit } from './parse'

describe('parseQty', () => {
  it('parses plain integers and decimals', () => {
    expect(parseQty('200').value).toBe(200)
    expect(parseQty('1.5').value).toBe(1.5)
    expect(parseQty(' 42 ').value).toBe(42)
  })

  it('parses European decimal commas', () => {
    expect(parseQty('2,5').value).toBe(2.5)
  })

  it('parses simple fractions', () => {
    expect(parseQty('1/2').value).toBe(0.5)
    expect(parseQty('3/4').value).toBe(0.75)
  })

  it('parses mixed numbers', () => {
    expect(parseQty('1 1/2').value).toBe(1.5)
    expect(parseQty('2 1/4').value).toBe(2.25)
  })

  it('takes the UPPER bound of a range', () => {
    expect(parseQty('1-2').value).toBe(2)
    expect(parseQty('1 - 3').value).toBe(3)
    expect(parseQty('1 to 2').value).toBe(2)
    expect(parseQty('2-1').value).toBe(2)
    expect(parseQty('1/2 - 2').value).toBe(2)
    expect(parseQty('1 1/2 - 2').value).toBe(2)
  })

  it('returns null with no note for an empty quantity', () => {
    expect(parseQty('').value).toBeNull()
    expect(parseQty(undefined).value).toBeNull()
    expect(parseQty('   ').unparsed).toBeUndefined()
  })

  it('flags non-numeric quantities as unparsed', () => {
    expect(parseQty('a pinch')).toEqual({ value: null, unparsed: 'a pinch' })
    expect(parseQty('to taste').unparsed).toBe('to taste')
  })

  it('never throws on a malformed fraction', () => {
    expect(parseQty('1/0').value).toBeNull()
  })
})

describe('splitQtyAndUnit', () => {
  it('splits a packed mass / volume amount (the #238 bug case)', () => {
    expect(splitQtyAndUnit('350 g')).toEqual({ qty: '350', unit: 'g' })
    expect(splitQtyAndUnit('200 ml')).toEqual({ qty: '200', unit: 'ml' })
    expect(splitQtyAndUnit('2 el')).toEqual({ qty: '2', unit: 'el' })
  })

  it('handles a packed amount with no space ("200ml")', () => {
    expect(splitQtyAndUnit('200ml')).toEqual({ qty: '200', unit: 'ml' })
  })

  it('keeps a bare number as a unitless count', () => {
    expect(splitQtyAndUnit('4')).toEqual({ qty: '4', unit: undefined })
  })

  it('splits a fraction or mixed-number head from its unit', () => {
    expect(splitQtyAndUnit('1/2 tsp')).toEqual({ qty: '1/2', unit: 'tsp' })
    expect(splitQtyAndUnit('1 1/2 cup')).toEqual({ qty: '1 1/2', unit: 'cup' })
  })

  it('keeps a range head whole and splits the unit', () => {
    expect(splitQtyAndUnit('1-2 el')).toEqual({ qty: '1 - 2', unit: 'el' })
    expect(splitQtyAndUnit('1 to 2 cloves')).toEqual({
      qty: '1 - 2',
      unit: 'cloves',
    })
    expect(splitQtyAndUnit('1/2 - 2')).toEqual({
      qty: '1/2 - 2',
      unit: undefined,
    })
    expect(splitQtyAndUnit('1/2 - 2 tsp')).toEqual({
      qty: '1/2 - 2',
      unit: 'tsp',
    })
  })

  it('splits a European decimal comma head', () => {
    expect(splitQtyAndUnit('2,5 dl')).toEqual({ qty: '2,5', unit: 'dl' })
  })

  it('keeps a multi-word count unit ("3 tenen")', () => {
    expect(splitQtyAndUnit('3 tenen')).toEqual({ qty: '3', unit: 'tenen' })
  })

  it('returns nothing for a non-numeric or empty amount', () => {
    expect(splitQtyAndUnit('a pinch')).toEqual({
      qty: undefined,
      unit: undefined,
    })
    expect(splitQtyAndUnit('')).toEqual({ qty: undefined, unit: undefined })
    expect(splitQtyAndUnit(undefined)).toEqual({
      qty: undefined,
      unit: undefined,
    })
  })

  it('round-trips through parseQty for the numeric head', () => {
    const s = splitQtyAndUnit('350 g')
    expect(parseQty(s.qty).value).toBe(350)
  })
})
