import { describe, it, expect } from 'vitest'
import {
  normaliseItemName,
  lineToNewItem,
  sumAmounts,
  concatAmounts,
  mergeAmount,
  planMerge,
  shouldAutoSeed,
  countMissing,
  backfillAmounts,
  addToListCta,
} from './persist'
import type { ShoppingItem, NewShoppingItem } from './persist'
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

describe('shouldAutoSeed', () => {
  it('seeds when a week is planned and no rows are saved yet', () => {
    expect(shouldAutoSeed({ planId: 'plan-1', savedItemCount: 0 })).toBe(true)
  })

  it('does not seed when rows already exist (idempotent revisit)', () => {
    expect(shouldAutoSeed({ planId: 'plan-1', savedItemCount: 3 })).toBe(false)
  })

  it('does not seed when there is no planned week', () => {
    expect(shouldAutoSeed({ planId: null, savedItemCount: 0 })).toBe(false)
  })

  it('does not re-seed a list the user cleared back down to one row', () => {
    // A single staple still counts as "has rows"; the page must not refill.
    expect(shouldAutoSeed({ planId: 'plan-1', savedItemCount: 1 })).toBe(false)
  })

  it('does not re-seed an empty list the user deliberately cleared', () => {
    expect(
      shouldAutoSeed({
        planId: 'plan-1',
        savedItemCount: 0,
        clearedByUser: true,
      }),
    ).toBe(false)
  })

  it('still seeds an empty list when the empty is not user-cleared', () => {
    expect(
      shouldAutoSeed({
        planId: 'plan-1',
        savedItemCount: 0,
        clearedByUser: false,
      }),
    ).toBe(true)
  })
})

describe('countMissing', () => {
  it('counts only the lines that are new to the list', () => {
    const existing = [item({ name: 'Onion' }), item({ name: 'Garlic' })]
    const incoming = [
      lineToNewItem(line({ name: 'Onion' })), // already present
      lineToNewItem(line({ name: 'Carrot' })), // new
      lineToNewItem(line({ name: 'Leek' })), // new
    ]
    expect(countMissing(existing, incoming)).toBe(2)
  })

  it('is zero when every week ingredient is already on the list', () => {
    const existing = [item({ name: 'Onion' }), item({ name: 'Garlic' })]
    const incoming = [
      lineToNewItem(line({ name: 'onion' })), // case-insensitive match
      lineToNewItem(line({ name: 'Garlic' })),
    ]
    expect(countMissing(existing, incoming)).toBe(0)
  })

  it('counts every line when the saved list is empty', () => {
    const incoming = [
      lineToNewItem(line({ name: 'Onion' })),
      lineToNewItem(line({ name: 'Garlic' })),
    ]
    expect(countMissing([], incoming)).toBe(2)
  })

  it('de-dupes repeated incoming lines so they count once', () => {
    const incoming = [
      lineToNewItem(line({ name: 'Onion' })),
      lineToNewItem(line({ name: 'onion' })),
    ]
    expect(countMissing([], incoming)).toBe(1)
  })
})

describe('addToListCta', () => {
  it('greys out with "All added" when nothing is missing', () => {
    expect(addToListCta(0)).toEqual({ label: 'All added', disabled: true })
  })

  it('uses the singular noun for exactly one missing item', () => {
    expect(addToListCta(1)).toEqual({
      label: 'Add 1 item to shopping list',
      disabled: false,
    })
  })

  it('uses the plural noun for several missing items', () => {
    expect(addToListCta(4)).toEqual({
      label: 'Add 4 items to shopping list',
      disabled: false,
    })
  })

  it('treats a negative count as nothing-to-add', () => {
    expect(addToListCta(-2).disabled).toBe(true)
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

describe('backfillAmounts', () => {
  function derived(
    partial: Partial<NewShoppingItem> & { name: string },
  ): NewShoppingItem {
    return {
      amount: null,
      unit: null,
      source: 'recipe',
      ...partial,
    }
  }

  it('fills a blank recipe row from a freshly derived amount, matched by name', () => {
    const broccoli = item({ name: 'broccoli', amount: null, source: 'recipe' })
    const updates = backfillAmounts(
      [broccoli],
      [derived({ name: 'Broccoli', amount: '300 g', unit: 'g' })],
    )
    expect(updates).toEqual([{ id: broccoli.id, amount: '300 g', unit: 'g' }])
  })

  it('treats a whitespace-only amount as blank and fills it', () => {
    const row = item({ name: 'melk', amount: '   ', source: 'recipe' })
    const updates = backfillAmounts(
      [row],
      [derived({ name: 'melk', amount: '200 ml', unit: 'ml' })],
    )
    expect(updates).toEqual([{ id: row.id, amount: '200 ml', unit: 'ml' }])
  })

  it('never clobbers a row that already carries an amount (a user edit)', () => {
    const row = item({ name: 'broccoli', amount: '2 heads', source: 'recipe' })
    const updates = backfillAmounts(
      [row],
      [derived({ name: 'broccoli', amount: '300 g', unit: 'g' })],
    )
    expect(updates).toEqual([])
  })

  it('leaves non-recipe rows alone even when a recipe name matches', () => {
    const manual = item({ name: 'broccoli', amount: null, source: 'manual' })
    const staple = item({ name: 'melk', amount: null, source: 'staple' })
    const updates = backfillAmounts(
      [manual, staple],
      [
        derived({ name: 'broccoli', amount: '300 g', unit: 'g' }),
        derived({ name: 'melk', amount: '200 ml', unit: 'ml' }),
      ],
    )
    expect(updates).toEqual([])
  })

  it('leaves a blank row blank when the derived line has no amount', () => {
    // 'snufje' (a pinch) derives to no amount, so the '+' affordance stays.
    const row = item({ name: 'zout', amount: null, source: 'recipe' })
    const updates = backfillAmounts(
      [row],
      [derived({ name: 'zout', amount: null })],
    )
    expect(updates).toEqual([])
  })

  it('only touches rows the current week can supply, ignoring the rest', () => {
    const known = item({ name: 'citroen', amount: null, source: 'recipe' })
    const orphan = item({ name: 'oude-rest', amount: null, source: 'recipe' })
    const updates = backfillAmounts(
      [known, orphan],
      [derived({ name: 'Citroen', amount: '1', unit: null })],
    )
    expect(updates).toEqual([{ id: known.id, amount: '1', unit: null }])
  })

  it('matches case-insensitively and on collapsed whitespace', () => {
    const row = item({ name: '  Rode   Ui ', amount: null, source: 'recipe' })
    const updates = backfillAmounts(
      [row],
      [derived({ name: 'rode ui', amount: '2', unit: null })],
    )
    expect(updates).toEqual([{ id: row.id, amount: '2', unit: null }])
  })

  it('is a no-op when nothing is stale', () => {
    const full = item({ name: 'broccoli', amount: '300 g', source: 'recipe' })
    expect(
      backfillAmounts(
        [full],
        [derived({ name: 'broccoli', amount: '300 g', unit: 'g' })],
      ),
    ).toEqual([])
  })
})
