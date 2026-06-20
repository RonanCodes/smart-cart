import { describe, expect, it } from 'vitest'
import {
  catalogueFromRows,
  cataloguesFromRows,
  rowToStoreProduct,
} from './store-product-catalogue'
import { matchIngredient } from './match'
import { toStoreProductRow } from './store-product-rows'
import type { StoreProduct } from './types'
import type { StoreProductRowLike } from './store-product-catalogue'

function product(overrides: Partial<StoreProduct> = {}): StoreProduct {
  return {
    store: 'ah',
    name: 'Halfvolle melk',
    normalisedName: 'halfvolle melk',
    priceCents: 109,
    slug: 'wi123/halfvolle-melk',
    size: {
      raw: '1 l',
      quantity: 1,
      unit: 'l',
      dimension: 'volume',
      approx: false,
    },
    ...overrides,
  }
}

/** A D1 row as the seeder writes it (raw = verbatim StoreProduct). */
function row(p: StoreProduct): StoreProductRowLike {
  const r = toStoreProductRow(p)
  return {
    store: r.store,
    slug: r.slug,
    name: r.name,
    priceCents: r.priceCents,
    unit: r.unit,
    raw: r.raw,
  }
}

describe('rowToStoreProduct', () => {
  it('round-trips the verbatim raw blob losslessly', () => {
    const p = product()
    expect(rowToStoreProduct(row(p))).toEqual(p)
  })

  it('reconstructs from flat columns when raw is missing', () => {
    const rebuilt = rowToStoreProduct({
      store: 'jumbo',
      slug: 'abc/penne',
      name: 'Jumbo Penne 500 g',
      priceCents: 89,
      unit: 'g',
      raw: null,
    })
    expect(rebuilt).toMatchObject({
      store: 'jumbo',
      name: 'Jumbo Penne 500 g',
      normalisedName: 'jumbo penne 500 g',
      priceCents: 89,
      slug: 'abc/penne',
    })
    expect(rebuilt?.size.unit).toBe('g')
  })

  it('reconstructs from flat columns when raw is malformed', () => {
    const rebuilt = rowToStoreProduct({
      store: 'ah',
      slug: null,
      name: 'Kipfilet',
      priceCents: 499,
      unit: null,
      raw: { not: 'a product' },
    })
    expect(rebuilt?.name).toBe('Kipfilet')
    expect(rebuilt?.priceCents).toBe(499)
  })

  it('drops a row with no usable price and no raw blob', () => {
    expect(
      rowToStoreProduct({
        store: 'ah',
        slug: null,
        name: 'Mystery',
        priceCents: null,
        unit: null,
        raw: null,
      }),
    ).toBeNull()
  })
})

describe('cataloguesFromRows', () => {
  it('groups rows by store', () => {
    const cats = cataloguesFromRows([
      row(product({ store: 'ah', slug: 'a' })),
      row(product({ store: 'jumbo', slug: 'b', name: 'Jumbo melk' })),
    ])
    expect(Object.keys(cats).sort()).toEqual(['ah', 'jumbo'])
    expect(cats.ah!.products).toHaveLength(1)
    expect(cats.jumbo!.products[0]!.name).toBe('Jumbo melk')
  })

  it('skips rows that cannot be reconstructed', () => {
    const cats = cataloguesFromRows([
      row(product({ slug: 'good' })),
      {
        store: 'ah',
        slug: null,
        name: 'bad',
        priceCents: null,
        unit: null,
        raw: null,
      },
    ])
    expect(cats.ah!.products).toHaveLength(1)
  })
})

describe('catalogueFromRows + matchIngredient (the D1 product link)', () => {
  it('resolves an ingredient name to a seeded product via the rebuilt catalogue', () => {
    const cat = catalogueFromRows('ah', [
      row(
        product({ name: 'AH Penne pasta', slug: 'wi9/penne', priceCents: 99 }),
      ),
      row(
        product({
          name: 'AH Halfvolle melk',
          slug: 'wi1/melk',
          priceCents: 109,
        }),
      ),
    ])!
    const match = matchIngredient('500g pasta', cat)
    expect(match.product?.slug).toBe('wi9/penne')
    expect(match.priceCents).toBe(99)
  })

  it('matching the D1-rebuilt catalogue agrees with matching the original catalogue', () => {
    const products = [
      product({ name: 'AH Kipfilet', slug: 'wi5/kip', priceCents: 499 }),
      product({ name: 'AH Penne pasta', slug: 'wi9/penne', priceCents: 99 }),
    ]
    const fromRows = catalogueFromRows('ah', products.map(row))!
    const original = {
      store: 'ah',
      displayName: 'Albert Heijn',
      urlBase: null,
      products,
    }
    expect(matchIngredient('kipfilet', fromRows).product?.slug).toBe(
      matchIngredient('kipfilet', original).product?.slug,
    )
  })
})
