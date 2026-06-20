import { describe, expect, it } from 'vitest'
import { parseQty } from './parse'

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
