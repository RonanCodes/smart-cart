import { describe, expect, it } from 'vitest'
import {
  CATEGORY_ORDER,
  groupByCategory,
  ingredientCategory,
} from './ingredient-category'

describe('ingredientCategory', () => {
  it('places common produce', () => {
    expect(ingredientCategory('Vine tomatoes')).toBe('Produce')
    expect(ingredientCategory('Red onion')).toBe('Produce')
    expect(ingredientCategory('Garlic')).toBe('Produce')
    expect(ingredientCategory('Baby spinach')).toBe('Produce')
  })

  it('places dairy & cheese', () => {
    expect(ingredientCategory('Feta')).toBe('Dairy & cheese')
    expect(ingredientCategory('Parmesan')).toBe('Dairy & cheese')
    expect(ingredientCategory('Semi-skimmed milk')).toBe('Dairy & cheese')
  })

  it('places meat & fish', () => {
    expect(ingredientCategory('Chicken thigh')).toBe('Meat & fish')
    expect(ingredientCategory('Salmon fillet')).toBe('Meat & fish')
  })

  it('places pantry staples', () => {
    expect(ingredientCategory('Orzo')).toBe('Pantry')
    expect(ingredientCategory('Olive oil')).toBe('Pantry')
    expect(ingredientCategory('Gnocchi')).toBe('Pantry')
  })

  it('falls back to Other for unknown names', () => {
    expect(ingredientCategory('Mystery powder')).toBe('Other')
  })

  it('matches whole words, so eggplant is produce not dairy', () => {
    // "egg" is a Dairy keyword, but "eggplant" has its own Produce keyword and
    // the whole-word matcher stops "egg" bleeding into it.
    expect(ingredientCategory('Eggplant')).toBe('Produce')
    expect(ingredientCategory('Egg')).toBe('Dairy & cheese')
  })
})

describe('groupByCategory', () => {
  const rows = [
    { name: 'Vine tomatoes' },
    { name: 'Feta' },
    { name: 'Red onion' },
    { name: 'Chicken thigh' },
    { name: 'Mystery powder' },
  ]

  it('groups by category in CATEGORY_ORDER, dropping empty buckets', () => {
    const groups = groupByCategory(rows, (r) => r.name)
    expect(groups.map((g) => g.category)).toEqual([
      'Produce',
      'Meat & fish',
      'Dairy & cheese',
      'Other',
    ])
  })

  it('preserves item order within a group', () => {
    const produce = groupByCategory(rows, (r) => r.name).find(
      (g) => g.category === 'Produce',
    )
    expect(produce?.items.map((i) => i.name)).toEqual([
      'Vine tomatoes',
      'Red onion',
    ])
  })

  it('returns an empty array for no items', () => {
    expect(groupByCategory([], (r: { name: string }) => r.name)).toEqual([])
  })

  it('only ever uses known categories', () => {
    const groups = groupByCategory(rows, (r) => r.name)
    for (const g of groups) {
      expect(CATEGORY_ORDER).toContain(g.category)
    }
  })
})
