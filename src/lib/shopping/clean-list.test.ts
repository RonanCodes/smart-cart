import { describe, expect, it } from 'vitest'
import {
  cleanRows,
  dedupeKey,
  isNonGroceryWater,
  isZeroAmount,
} from './clean-list'
import type { CleanableRow } from './clean-list'

describe('isNonGroceryWater', () => {
  it('drops cooking water from the tap', () => {
    expect(isNonGroceryWater('water')).toBe(true)
    expect(isNonGroceryWater('Tap water')).toBe(true)
    expect(isNonGroceryWater('boiling water')).toBe(true)
    expect(isNonGroceryWater('  Hot Water ')).toBe(true)
    expect(isNonGroceryWater('cold water')).toBe(true)
    expect(isNonGroceryWater('ice water')).toBe(true)
  })

  it('ignores a trailing parenthetical note', () => {
    expect(isNonGroceryWater('water (for the pasta)')).toBe(true)
    expect(isNonGroceryWater('boiling water (1 L)')).toBe(true)
  })

  it('keeps real bottled / flavoured waters', () => {
    expect(isNonGroceryWater('sparkling water')).toBe(false)
    expect(isNonGroceryWater('coconut water')).toBe(false)
    expect(isNonGroceryWater('rose water')).toBe(false)
    expect(isNonGroceryWater('watermelon')).toBe(false)
  })
})

describe('isZeroAmount', () => {
  it('flags a quantity of nothing', () => {
    expect(isZeroAmount('0')).toBe(true)
    expect(isZeroAmount('0 tsp')).toBe(true)
    expect(isZeroAmount('0 g')).toBe(true)
    expect(isZeroAmount('0.0 ml')).toBe(true)
    expect(isZeroAmount('0,00 g')).toBe(true)
  })

  it('does not flag a real amount or a blank one', () => {
    expect(isZeroAmount(null)).toBe(false)
    expect(isZeroAmount('')).toBe(false)
    expect(isZeroAmount('   ')).toBe(false)
    expect(isZeroAmount('200 g')).toBe(false)
    expect(isZeroAmount('1 bulb')).toBe(false)
    expect(isZeroAmount('10 g')).toBe(false)
  })
})

describe('dedupeKey — spelling variants', () => {
  it('collapses chili / chilli to one key', () => {
    expect(dedupeKey('chili flakes')).toBe(dedupeKey('chilli flakes'))
    expect(dedupeKey('Chilli Flakes')).toBe('chilli flakes')
  })

  it('collapses yoghurt / yogurt', () => {
    expect(dedupeKey('Greek yoghurt')).toBe(dedupeKey('greek yogurt'))
  })

  it('still merges plain casing / whitespace', () => {
    expect(dedupeKey('  ONion ')).toBe('onion')
  })
})

interface Row extends CleanableRow {
  id: string
  checked?: boolean
}

const row = (id: string, name: string, amount: string | null): Row => ({
  id,
  name,
  amount,
})

describe('cleanRows', () => {
  it('drops cooking-water rows entirely', () => {
    const out = cleanRows([
      row('1', 'Vine tomatoes', '500 g'),
      row('2', 'tap water', '1200 ml'),
      row('3', 'boiling water', '900 ml'),
      row('4', 'Feta', '200 g'),
    ])
    expect(out.map((r) => r.name)).toEqual(['Vine tomatoes', 'Feta'])
  })

  it('blanks a zero amount but keeps the row', () => {
    const out = cleanRows([row('1', 'Chilli flakes', '0 tsp')])
    expect(out).toHaveLength(1)
    expect(out[0]!.amount).toBeNull()
    expect(out[0]!.name).toBe('Chilli flakes')
  })

  it('merges chili / chilli spelling variants into one row, summing amounts', () => {
    const out = cleanRows([
      row('1', 'chili flakes', '1 tsp'),
      row('2', 'chilli flakes', '2 tsp'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('1') // first-seen row wins, keeps its id
    expect(out[0]!.amount).toBe('3 tsp')
  })

  it('concatenates amounts that cannot be summed', () => {
    const out = cleanRows([
      row('1', 'chili flakes', '1 tsp'),
      row('2', 'chilli flakes', 'a pinch'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.amount).toBe('1 tsp + a pinch')
  })

  it('preserves order and all other fields on the kept row', () => {
    const out = cleanRows([
      { id: '1', name: 'Garlic', amount: '1 bulb', checked: true },
      { id: '2', name: 'water', amount: '1 L', checked: false },
      { id: '3', name: 'Lemon', amount: '3 pcs', checked: false },
    ])
    expect(out.map((r) => r.id)).toEqual(['1', '3'])
    expect(out[0]!.checked).toBe(true)
  })

  it('never drops a real grocery', () => {
    const out = cleanRows([
      row('1', 'Coconut water', '330 ml'),
      row('2', 'Sparkling water', '1 L'),
      row('3', 'Watermelon', '1 pc'),
    ])
    expect(out).toHaveLength(3)
  })
})
