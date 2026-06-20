import { describe, expect, it } from 'vitest'
import {
  storeProductId,
  toStoreProductRow,
  toStoreProductRows,
} from './store-product-rows'
import type { StoreProduct } from './types'

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

describe('storeProductId', () => {
  it('uses store + slug when a slug is present', () => {
    expect(storeProductId(product())).toBe('ah:wi123/halfvolle-melk')
  })

  it('falls back to store + normalisedName when there is no slug', () => {
    expect(storeProductId(product({ slug: null }))).toBe('ah:halfvolle melk')
  })

  it('falls back when the slug is blank whitespace', () => {
    expect(storeProductId(product({ slug: '   ' }))).toBe('ah:halfvolle melk')
  })

  it('is deterministic: same product gives the same id (idempotent upsert)', () => {
    expect(storeProductId(product())).toBe(storeProductId(product()))
  })
})

describe('toStoreProductRow', () => {
  it('maps the catalogue product onto the table columns', () => {
    expect(toStoreProductRow(product())).toMatchObject({
      id: 'ah:wi123/halfvolle-melk',
      store: 'ah',
      slug: 'wi123/halfvolle-melk',
      name: 'Halfvolle melk',
      priceCents: 109,
      unit: 'l',
    })
  })

  it('keeps the normalised product verbatim in raw', () => {
    const p = product()
    expect(toStoreProductRow(p).raw).toEqual(p)
  })

  it('carries a null unit when the pack size had none', () => {
    const p = product({
      size: {
        raw: '',
        quantity: null,
        unit: null,
        dimension: 'unknown',
        approx: false,
      },
    })
    expect(toStoreProductRow(p).unit).toBeNull()
  })

  it('null slug maps to a null slug column (id still derived from name)', () => {
    const row = toStoreProductRow(product({ slug: null }))
    expect(row.slug).toBeNull()
    expect(row.id).toBe('ah:halfvolle melk')
  })
})

describe('toStoreProductRows', () => {
  it('shapes every product into a row', () => {
    const rows = toStoreProductRows([
      product({ slug: 'a' }),
      product({ slug: 'b', store: 'jumbo' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.id)).toEqual(['ah:a', 'jumbo:b'])
  })

  it('de-dupes rows that resolve to the same id (last write wins)', () => {
    const rows = toStoreProductRows([
      product({ slug: 'dup', name: 'Old name' }),
      product({ slug: 'dup', name: 'New name' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('New name')
  })

  it('keeps the same store/slug distinct from a different store', () => {
    const rows = toStoreProductRows([
      product({ slug: 'x', store: 'ah' }),
      product({ slug: 'x', store: 'jumbo' }),
    ])
    expect(rows).toHaveLength(2)
  })
})
