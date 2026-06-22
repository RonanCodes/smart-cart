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
      // Derive a slug so each product is addable to the store cart (a real
      // catalogue row always carries one); slug-less products are excluded from
      // pricing now (#plan-cart-mismatch).
      d: products.map(([n, p, s]) => ({
        n,
        p,
        s,
        l: n.toLowerCase().replace(/\s+/g, '-'),
      })),
    },
  ]
  return buildCatalogues(raw)[slug]!
}

describe('deriveLiveCartSet: includes the CHECKED (in-order) set + selected extras', () => {
  it('keeps checked recipe lines and drops unchecked ones from every output', () => {
    const items = [
      item({ name: 'broccoli', amount: '300 g', checked: true }),
      item({ name: 'rice', amount: '500 g', checked: false }),
    ]
    const set = deriveLiveCartSet(items, [], new Set())

    // Only the CHECKED (in-order) broccoli survives; the unchecked rice drops.
    expect(set.itemNames).toEqual(['broccoli'])
    expect(set.compareLines).toEqual([{ name: 'broccoli', amount: '300 g' }])
    expect(set.staples).toEqual([])
  })

  it('folds SELECTED extras into the comparison and the cart staples', () => {
    const items = [item({ name: 'broccoli', amount: '300 g', checked: true })]
    const extras = [
      extra({ id: 'a', name: 'koffie', store: 'ah', slug: 'koffie-9' }),
      extra({ id: 'b', name: 'melk', store: 'jumbo', slug: 'melk-3' }),
    ]
    // Both extras selected (in the order).
    const set = deriveLiveCartSet(items, extras, new Set(['a', 'b']))

    // The combined comparison set = checked recipe lines PLUS selected extras
    // (extras have no amount).
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

  it('includes only the SELECTED extra in the comparison and the cart, reactively', () => {
    const items = [item({ name: 'broccoli', amount: '300 g', checked: true })]
    const extras = [
      extra({ id: 'a', name: 'koffie' }),
      extra({ id: 'b', name: 'melk' }),
    ]

    // Only the first extra is selected (in the order): melk stays out.
    const set = deriveLiveCartSet(items, extras, new Set(['a']))

    expect(set.compareLines.map((l) => l.name)).toEqual(['broccoli', 'koffie'])
    expect(set.staples).toHaveLength(1)
    expect(set.staples[0]!.slug).toBe('koffie-1')
  })

  it('returns an empty set when nothing is selected', () => {
    const items = [item({ name: 'broccoli', checked: false })]
    const extras = [extra({ id: 'a', name: 'koffie' })]
    const set = deriveLiveCartSet(items, extras, new Set())

    expect(set.compareLines).toEqual([])
    expect(set.itemNames).toEqual([])
    expect(set.staples).toEqual([])
  })
})

describe('basket math over the combined (recipe + extras) SELECTED set', () => {
  it('prices the SELECTED set and an unchecked item is excluded from price + waste', () => {
    const ah = cat('ah', [
      ['Broccoli', 1.0, '500 g'],
      ['Rijst', 2.0, '1 kg'],
      ['Koffie', 4.0, '250 g'],
    ])

    const items = [
      item({ name: 'broccoli', amount: '300 g', checked: true }), // 1 pack, 200 g waste, 100c
      item({ name: 'rijst', amount: '500 g', checked: false }), // UNCHECKED -> excluded
    ]
    const extras = [extra({ id: 'k', name: 'koffie' })] // no amount -> one pack, 400c

    // Recipe broccoli (checked) + the selected koffie extra are in the order.
    const set = deriveLiveCartSet(items, extras, new Set(['k']))
    const basket = basketForStore(set.compareLines, ah)

    // Only broccoli (recipe) + koffie (extra) are priced; rijst is not in order.
    expect(basket.lineItems.map((l) => l.ingredient)).toEqual([
      'broccoli',
      'koffie',
    ])
    expect(basket.totalCents).toBe(100 + 400)
    // Waste is only the broccoli leftover (koffie has no required amount).
    expect(basket.totalWaste.massGrams).toBe(200)
    expect(basket.totalWaste.cents).toBe(40)
  })

  it('adds the item to the basket when it is selected (checked) into the order', () => {
    const ah = cat('ah', [
      ['Broccoli', 1.0, '500 g'],
      ['Rijst', 2.0, '1 kg'],
    ])
    const items = [
      item({ name: 'broccoli', amount: '300 g', checked: true }),
      item({ name: 'rijst', amount: '500 g', checked: true }), // now selected
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
