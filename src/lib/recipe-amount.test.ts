import { describe, it, expect } from 'vitest'
import { scaleAmount } from './recipe-amount'

describe('scaleAmount — the serves stepper rescaling', () => {
  it('scales the leading number, keeping the unit', () => {
    expect(scaleAmount('500 g', 2)).toBe('1000 g')
    expect(scaleAmount('3 cloves', 0.5)).toBe('1.5 cloves')
    expect(scaleAmount('250 g', 1.5)).toBe('375 g')
  })
  it('handles a comma decimal and a bare number', () => {
    expect(scaleAmount('1,5 l', 2)).toBe('3 l')
    expect(scaleAmount('2', 3)).toBe('6')
  })
  it('leaves non-numeric and null amounts untouched', () => {
    expect(scaleAmount('snufje', 2)).toBe('snufje')
    expect(scaleAmount('to taste', 4)).toBe('to taste')
    expect(scaleAmount(null, 2)).toBeNull()
  })
  it('returns the amount unchanged for a non-positive or non-finite factor', () => {
    expect(scaleAmount('500 g', 0)).toBe('500 g')
    expect(scaleAmount('500 g', -1)).toBe('500 g')
    expect(scaleAmount('500 g', Number.NaN)).toBe('500 g')
  })
  it('strips trailing zeros so whole numbers stay clean', () => {
    expect(scaleAmount('100 g', 1)).toBe('100 g')
    expect(scaleAmount('1 stuk', 4)).toBe('4 stuk')
  })
})
