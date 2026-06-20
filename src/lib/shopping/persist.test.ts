import { describe, it, expect } from 'vitest'
import {
  normaliseItemName,
  lineToNewItem,
  sumAmounts,
  concatAmounts,
  mergeAmount,
  planMerge,
} from './persist'
import type { ShoppingItem } from './persist'
import type { ShoppingLine } from './types'

function line(partial: Partial<ShoppingLine> & { name: string }): ShoppingLine {
  return {
    displayAmount: '',
    usedInMeals: [],
    ...partial,
  }
}

function item(partial: Partial<ShoppingItem> & { name: string }): ShoppingItem {
  return {
    id: partial.id ?? `id-${partial.name}`,
    amount: null,
    unit: null,
    checked: false,
    source: 'manual',
    createdAt: 0,
    ...partial,
  }
}

describe('normaliseItemName', () => {
  it('lower-cases, trims, and collapses inner whitespace', () => {
    expect(normaliseItemName('  ONion  ')).toBe('onion')
    expect(normaliseItemName('Red   Pepper')).toBe('red pepper')
  })
})

describe('lineToNewItem', () => {
  it('keeps a real display amount and marks the source as recipe', () => {
    const result = lineToNewItem(
      line({ name: 'Onion', displayAmount: '450 g', unit: 'g' }),
    )
    expect(result).toEqual({
      name: 'Onion',
      amount: '450 g',
      unit: 'g',
      source: 'recipe',
    })
  })

  it('drops an unspecified-amount placeholder to null', () => {
    const result = lineToNewItem(
      line({ name: 'Salt', displayAmount: '(unspecified amount)' }),
    )
    expect(result.amount).toBeNull()
    expect(result.unit).toBeNull()
  })
})

describe('sumAmounts', () => {
  it('sums two amounts that share a unit', () => {
    expect(sumAmounts('450 g', '200 g')).toBe('650 g')
    expect(sumAmounts('1.5 l', '0.5 l')).toBe('2 l')
  })

  it('sums bare counts', () => {
    expect(sumAmounts('2', '3')).toBe('5')
  })

  it('refuses to sum across different units', () => {
    expect(sumAmounts('2', '15 g')).toBeNull()
    expect(sumAmounts('1 l', '1 kg')).toBeNull()
  })

  it('refuses compound or annotated amounts', () => {
    expect(sumAmounts('2 + 15 g', '1 g')).toBeNull()
    expect(sumAmounts('450 g (to taste)', '50 g')).toBeNull()
  })

  it('passes through when one side is null', () => {
    expect(sumAmounts(null, '200 g')).toBe('200 g')
    expect(sumAmounts('200 g', null)).toBe('200 g')
  })
})

describe('concatAmounts', () => {
  it('joins distinct amounts with a plus', () => {
    expect(concatAmounts('2 cloves', '15 g')).toBe('2 cloves + 15 g')
  })

  it('collapses identical amounts', () => {
    expect(concatAmounts('a pinch', 'a pinch')).toBe('a pinch')
  })

  it('passes through nulls', () => {
    expect(concatAmounts(null, '2')).toBe('2')
    expect(concatAmounts('2', null)).toBe('2')
  })
})

describe('mergeAmount', () => {
  it('prefers summing, falls back to concat', () => {
    expect(mergeAmount('100 g', '50 g')).toBe('150 g')
    expect(mergeAmount('2 cloves', '15 g')).toBe('2 cloves + 15 g')
  })
})

describe('planMerge', () => {
  it('inserts lines that are not already present', () => {
    const plan = planMerge(
      [],
      [
        { name: 'Onion', amount: '2', unit: null, source: 'recipe' },
        { name: 'Garlic', amount: '3 cloves', unit: null, source: 'recipe' },
      ],
    )
    expect(plan.inserts).toHaveLength(2)
    expect(plan.updates).toHaveLength(0)
  })

  it('merges an incoming line into a matching existing row by normalised name', () => {
    const onion = item({ name: 'Onion', amount: '200 g', source: 'manual' })
    const plan = planMerge(
      [onion],
      [{ name: '  onion ', amount: '300 g', unit: 'g', source: 'recipe' }],
    )
    expect(plan.inserts).toHaveLength(0)
    expect(plan.updates).toEqual([{ id: onion.id, amount: '500 g' }])
  })

  it('accumulates two incoming lines onto the same existing row', () => {
    const flour = item({ name: 'Flour', amount: '100 g' })
    const plan = planMerge(
      [flour],
      [
        { name: 'Flour', amount: '50 g', unit: 'g', source: 'recipe' },
        { name: 'flour', amount: '25 g', unit: 'g', source: 'recipe' },
      ],
    )
    expect(plan.updates).toEqual([{ id: flour.id, amount: '175 g' }])
  })

  it('merges two incoming lines for the same new item into one insert', () => {
    const plan = planMerge(
      [],
      [
        { name: 'Tomato', amount: '2', unit: null, source: 'recipe' },
        { name: 'tomato', amount: '3', unit: null, source: 'recipe' },
      ],
    )
    expect(plan.inserts).toHaveLength(1)
    expect(plan.inserts[0]?.amount).toBe('5')
  })
})
