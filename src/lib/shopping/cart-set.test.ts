import { describe, expect, it } from 'vitest'
import { deriveLiveCartSet } from './cart-set'
import type { CartExtra } from './cart-set'
import type { ShoppingItem } from './persist'
import { basketForStore } from '../pricing/basket'
import { buildCatalogues } from '../pricing/normalise'
import type { RawStore, StoreCatalogue } from '../pricing/types'

/** A shopping-list item with sensible defaults; override per case. */
function item(partial: Partial<ShoppingItem> & { name: string }): ShoppingItem {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    amount: partial.amount ?? null,
    unit: partial.unit ?? null,
    checked: partial.checked ?? false,
    source: partial.source ?? 'recipe',
    createdAt: partial.createdAt ?? 0,
  }
}

/** An extra / staple with defaults. */
function extra(partial: Partial<CartExtra> & { name: string }): CartExtra {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    store: partial.store ?? 'ah',
    slug: partial.slug ?? `${partial.name}-1`,
  }
}

/** Build a one-store catalogue from [name, priceEur, packSize] tuples. */
function cat(
  slug: string,
  products: Array<[string, number, string]>,
): StoreCatalogue {
  const raw: Array<RawStore> = [
    {
      n: slug,
      c: slug.toUpperCase(),
      d: products.map(([n, p, s]) => ({ n, p, s })),
    },
  ]
  return buildCatalogues(raw)[slug]!
}

describe('deriveLiveCartSet: excludes checked, includes extras', () => {
  it('keeps unchecked recipe lines and drops checked ones from every output', () => {
    const items = [
      item({ name: 'broccoli', amount: '300 g', checked: false }),
      item({ name: 'rice', amount: '500 g', checked: true }),
    ]
    const set = deriveLiveCartSet(items, [], new Set())

    expect(set.itemNames).toEqual(['broccoli'])
    expect(set.compareLines).toEqual([{ name: 'broccoli', amount: '300 g' }])
    expect(set.staples).toEqual([])
  })

  it('folds the extras into the comparison and the cart staples', () => {
    const items = [item({ name: 'broccoli', amount: '300 g' })]
    const extras = [
      extra({ name: 'koffie', store: 'ah', slug: 'koffie-9' }),
      extra({ name: 'melk', store: 'jumbo', slug: 'melk-3' }),
    ]
    const set = deriveLiveCartSet(items, extras, new Set())

    // The combined comparison set = recipe lines PLUS extras (extras have no amount).
    expect(set.compareLines).toEqual([
      { name: 'broccoli', amount: '300 g' },
      { name: 'koffie', amount: null },
      { name: 'melk', amount: null },
    ])
    // Item names stay separate from extras (server resolves them differently).
    expect(set.itemNames).toEqual(['broccoli'])
    expect(set.staples).toEqual([
      { slug: 'koffie-9', store: 'ah' },
      { slug: 'melk-3', store: 'jumbo' },
    ])
  })

  it('drops a checked extra from the comparison and the cart, reactively', () => {
    const items = [item({ name: 'broccoli', amount: '300 g' })]
    const extras = [
      extra({ id: 'a', name: 'koffie' }),
      extra({ id: 'b', name: 'melk' }),
    ]

    // Tick the second extra off ("already have melk"): it leaves both outputs.
    const set = deriveLiveCartSet(items, extras, new Set(['b']))

    expect(set.compareLines.map((l) => l.name)).toEqual(['broccoli', 'koffie'])
    expect(set.staples).toHaveLength(1)
    expect(set.staples[0]!.slug).toBe('koffie-1')
  })

  it('returns an empty set when everything is checked', () => {
    const items = [item({ name: 'broccoli', checked: true })]
    const extras = [extra({ id: 'a', name: 'koffie' })]
    const set = deriveLiveCartSet(items, extras, new Set(['a']))

    expect(set.compareLines).toEqual([])
    expect(set.itemNames).toEqual([])
    expect(set.staples).toEqual([])
  })
})

describe('basket math over the combined (recipe + extras) set', () => {
  it('prices the combined set and a checked item is excluded from price + waste', () => {
    const ah = cat('ah', [
      ['Broccoli', 1.0, '500 g'],
      ['Rijst', 2.0, '1 kg'],
      ['Koffie', 4.0, '250 g'],
    ])

    const items = [
      item({ name: 'broccoli', amount: '300 g' }), // 1 pack, 200 g waste, 100c
      item({ name: 'rijst', amount: '500 g', checked: true }), // CHECKED -> excluded
    ]
    const extras = [extra({ name: 'koffie' })] // no amount -> one pack, 400c

    const set = deriveLiveCartSet(items, extras, new Set())
    const basket = basketForStore(set.compareLines, ah)

    // Only broccoli (recipe) + koffie (extra) are priced; rijst is ticked off.
    expect(basket.lineItems.map((l) => l.ingredient)).toEqual([
      'broccoli',
      'koffie',
    ])
    expect(basket.totalCents).toBe(100 + 400)
    // Waste is only the broccoli leftover (koffie has no required amount).
    expect(basket.totalWaste.massGrams).toBe(200)
    expect(basket.totalWaste.cents).toBe(40)
  })

  it('adds the checked item back to the basket when it is unticked', () => {
    const ah = cat('ah', [
      ['Broccoli', 1.0, '500 g'],
      ['Rijst', 2.0, '1 kg'],
    ])
    const items = [
      item({ name: 'broccoli', amount: '300 g' }),
      item({ name: 'rijst', amount: '500 g', checked: false }), // now unticked
    ]
    const set = deriveLiveCartSet(items, [], new Set())
    const basket = basketForStore(set.compareLines, ah)

    expect(basket.lineItems.map((l) => l.ingredient)).toEqual([
      'broccoli',
      'rijst',
    ])
    // Broccoli 1 pack (100c) + rijst 1 pack (200c) = 300c.
    expect(basket.totalCents).toBe(300)
  })
})
