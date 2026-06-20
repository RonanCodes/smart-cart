import { describe, expect, it } from 'vitest'
import {
  catalogueFromRows,
  resolveIngredientFromRows,
  rowToStoreProduct,
} from './store-product-resolve'
import type { StoreProductRowLike } from './store-product-resolve'
import type { StoreProduct } from './types'

/** A normalised StoreProduct, as the seeder stores it in `store_product.raw`. */
function product(
  over: Partial<StoreProduct> & Pick<StoreProduct, 'store' | 'name'>,
): StoreProduct {
  return {
    store: over.store,
    name: over.name,
    normalisedName: over.normalisedName ?? over.name.toLowerCase(),
    priceCents: over.priceCents ?? 199,
    slug: over.slug ?? null,
    size: over.size ?? {
      raw: '',
      quantity: null,
      unit: null,
      dimension: 'unknown',
      approx: false,
    },
  }
}

/** Build a D1 row from a normalised product (mirrors toStoreProductRow). */
function row(
  p: StoreProduct,
  id = `${p.store}:${p.slug ?? p.normalisedName}`,
): StoreProductRowLike {
  return {
    id,
    store: p.store,
    slug: p.slug,
    name: p.name,
    priceCents: p.priceCents,
    raw: p,
  }
}

describe('rowToStoreProduct', () => {
  it('rebuilds the product from the verbatim raw blob', () => {
    const p = product({
      store: 'ah',
      name: 'AH Penne pasta 500 g',
      slug: 'wi123/penne',
    })
    expect(rowToStoreProduct(row(p))).toEqual(p)
  })

  it('falls back to flat columns when raw is missing', () => {
    const r: StoreProductRowLike = {
      id: 'ah:melk',
      store: 'ah',
      slug: 'wi9/melk',
      name: 'Halfvolle melk',
      priceCents: 109,
      raw: null,
    }
    const p = rowToStoreProduct(r)
    expect(p).not.toBeNull()
    expect(p?.name).toBe('Halfvolle melk')
    expect(p?.priceCents).toBe(109)
    expect(p?.slug).toBe('wi9/melk')
  })

  it('drops a row that has neither raw nor a price (never invents a price)', () => {
    const r: StoreProductRowLike = {
      id: 'ah:x',
      store: 'ah',
      slug: null,
      name: 'mystery',
      priceCents: null,
      raw: null,
    }
    expect(rowToStoreProduct(r)).toBeNull()
  })

  it('ignores a malformed raw blob and uses the columns', () => {
    const r: StoreProductRowLike = {
      id: 'ah:y',
      store: 'ah',
      slug: 'wi5/kaas',
      name: 'Jong belegen kaas',
      priceCents: 425,
      raw: { not: 'a product' },
    }
    expect(rowToStoreProduct(r)?.priceCents).toBe(425)
  })
})

describe('catalogueFromRows', () => {
  it('groups rows into one catalogue per store and drops priceless rows', () => {
    const rows: Array<StoreProductRowLike> = [
      row(
        product({
          store: 'ah',
          name: 'Kipfilet',
          slug: 'wi1/kip',
          priceCents: 599,
        }),
      ),
      row(
        product({
          store: 'ah',
          name: 'Tomaten',
          slug: 'wi2/tomaat',
          priceCents: 149,
        }),
      ),
      row(
        product({
          store: 'jumbo',
          name: 'Kipfilet',
          slug: 'kip-128692ZK',
          priceCents: 549,
        }),
      ),
      {
        id: 'ah:bad',
        store: 'ah',
        slug: null,
        name: 'no price',
        priceCents: null,
        raw: null,
      },
    ]
    const cats = catalogueFromRows(rows)
    expect(cats.get('ah')?.products).toHaveLength(2)
    expect(cats.get('jumbo')?.products).toHaveLength(1)
  })
})

describe('resolveIngredientFromRows', () => {
  const rows: Array<StoreProductRowLike> = [
    row(
      product({
        store: 'ah',
        name: 'AH Kipfilet 500 g',
        slug: 'wi415202/kipfilet',
        priceCents: 599,
      }),
    ),
    row(
      product({
        store: 'ah',
        name: 'Verse penne pasta 500 g',
        slug: 'wi777/penne',
        priceCents: 159,
      }),
    ),
    row(
      product({
        store: 'jumbo',
        name: 'Jumbo Kipfilet naturel',
        slug: 'kipfilet-naturel-128692ZK',
        priceCents: 549,
      }),
    ),
  ]
  const cats = catalogueFromRows(rows)

  it('matches an ingredient to the right store product with a slug to deep-link', () => {
    const m = resolveIngredientFromRows('500g kipfilet', 'ah', cats)
    expect(m.product?.slug).toBe('wi415202/kipfilet')
    expect(m.confidence).not.toBe('none')
  })

  it('resolves per store independently', () => {
    const m = resolveIngredientFromRows('kipfilet', 'jumbo', cats)
    expect(m.product?.slug).toBe('kipfilet-naturel-128692ZK')
  })

  it('returns a clean no-match for an unknown store', () => {
    const m = resolveIngredientFromRows('kipfilet', 'dirk', cats)
    expect(m.product).toBeNull()
    expect(m.confidence).toBe('none')
  })

  it('returns a no-match (not a bad guess) for an ingredient with no plausible product', () => {
    const m = resolveIngredientFromRows('dragon fruit szechuan', 'ah', cats)
    expect(m.product).toBeNull()
  })
})
