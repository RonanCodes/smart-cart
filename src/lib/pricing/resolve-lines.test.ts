import { describe, expect, it } from 'vitest'
import { splitAmount } from './resolve-lines'

describe('splitAmount', () => {
  it('splits a leading quantity from a trailing unit', () => {
    expect(splitAmount('150 g')).toEqual({ qty: '150', unit: 'g' })
    expect(splitAmount('1.5 kg')).toEqual({ qty: '1.5', unit: 'kg' })
    expect(splitAmount('2 stuks')).toEqual({ qty: '2', unit: 'stuks' })
  })

  it('handles a comma decimal and a fraction', () => {
    expect(splitAmount('2,5 l')).toEqual({ qty: '2,5', unit: 'l' })
    expect(splitAmount('1/2 tsp')).toEqual({ qty: '1/2', unit: 'tsp' })
  })

  it('keeps a unit-only amount as the unit', () => {
    expect(splitAmount('a pinch')).toEqual({ qty: null, unit: 'a pinch' })
  })

  it('returns nulls for empty / nullish amounts', () => {
    expect(splitAmount(null)).toEqual({ qty: null, unit: null })
    expect(splitAmount(undefined)).toEqual({ qty: null, unit: null })
    expect(splitAmount('   ')).toEqual({ qty: null, unit: null })
  })

  it('feeds the rerank a clean qty even when the unit is leaked Dutch', () => {
    // "1.5 tenen" (cloves) is a cooking unit; the rerank gets qty 1.5 + the
    // raw unit so it can still size-match without the basket maths choking.
    expect(splitAmount('1.5 tenen')).toEqual({ qty: '1.5', unit: 'tenen' })
  })
})
