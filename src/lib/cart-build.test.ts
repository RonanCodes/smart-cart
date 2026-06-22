import { describe, it, expect } from 'vitest'
import { buildAllItemsCartUrl } from './cart-build'
import {
  ahProductId,
  mergeCartLineItems,
  AH_BULK_CHUNK_SIZE,
} from './cart-links'

describe('buildAllItemsCartUrl', () => {
  it('builds an AH link from resolved slugs across week + extras', () => {
    const res = buildAllItemsCartUrl('ah', [
      { slug: 'wi415202/100-coconut-grove' }, // a week line
      { slug: 'wi2798' }, // a staple
    ])
    expect(res.store).toBe('ah')
    expect(res.matched).toBe(2)
    expect(res.total).toBe(2)
    expect(res.url).toBe(
      'https://www.ah.nl/mijnlijst/add-multiple?p=415202:1&p=2798:1',
    )
    expect(res.urls).toEqual([res.url])
  })

  it('builds a Jumbo link from trailing-token slugs', () => {
    const res = buildAllItemsCartUrl('jumbo', [
      { slug: '11er-spek-rosti-350-g-128692ZK' },
      { slug: '1fruit-appel-200ml-764448PAK' },
    ])
    expect(res.matched).toBe(2)
    expect(res.urls).toHaveLength(1)
    const add = new URL(res.url!).searchParams.get('add')!
    expect(JSON.parse(add)).toEqual([
      { sku: '128692ZK', quantity: 1 },
      { sku: '764448PAK', quantity: 1 },
    ])
  })

  it('skips unmatched (null) slugs but still counts them in the total', () => {
    const res = buildAllItemsCartUrl('ah', [
      { slug: 'wi415202/x' },
      { slug: null },
      { slug: null },
    ])
    expect(res.matched).toBe(1)
    expect(res.total).toBe(3)
    expect(res.url).toBe('https://www.ah.nl/mijnlijst/add-multiple?p=415202:1')
    expect(res.urls).toEqual([res.url])
  })

  it('chunks large AH carts into multiple add-multiple URLs', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      slug: `wi${i + 1}/x`,
    }))
    const res = buildAllItemsCartUrl('ah', items)
    expect(res.matched).toBe(30)
    expect(res.urls).toHaveLength(2)
    expect(res.url).toBe(res.urls[1])
  })

  it('chunks large Jumbo carts into multiple mandje URLs', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      slug: `item-${i + 1}-SKU${i + 1}PAK`,
    }))
    const res = buildAllItemsCartUrl('jumbo', items)
    expect(res.matched).toBe(30)
    expect(res.urls).toHaveLength(2)
    expect(res.url).toBe(res.urls[1])
  })

  it('returns a null url when nothing resolved', () => {
    const res = buildAllItemsCartUrl('jumbo', [{ slug: null }, { slug: null }])
    expect(res.url).toBeNull()
    expect(res.matched).toBe(0)
    expect(res.total).toBe(2)
  })

  it('only ever resolves the SELECTED store (decoupling)', () => {
    // The same slugs, sent to each store, produce store-specific URLs and never
    // a cross-store leak: an AH build is an ah.nl URL, a Jumbo build a jumbo.com
    // URL. Picking one store can never fire the other.
    const slugs = [{ slug: 'wi415202/x' }]
    expect(buildAllItemsCartUrl('ah', slugs).url).toContain('ah.nl')
    expect(buildAllItemsCartUrl('jumbo', slugs).url).toContain('jumbo.com')
  })
})

/**
 * AH URL FAITHFULNESS — the "check once in the cart, it's correct" invariant.
 *
 * This is the guard that would have caught "44 items in the cart, only 27 in AH".
 * Given a set of resolved items, we BUILD the AH URLs, PARSE the `?p=<sku>:<qty>`
 * tokens back out, and assert the round-trip is exact:
 *   (a) distinct SKUs in the URL == input items that carry a real SKU,
 *   (b) each SKU's qty in the URL == the merged input qty,
 *   (c) chunk count == ceil(skuCount / AH_BULK_CHUNK_SIZE), no chunk over the size,
 *   (d) an all-null-slug input yields zero URLs.
 *
 * It works off the SAME pure builders the cart uses (cart-build -> cart-links),
 * so a regression that drops/duplicates/mis-counts SKUs fails `pnpm quality`.
 */
describe('AH URL faithfulness (build -> parse -> count round-trip)', () => {
  /** Every `p=<sku>:<qty>` token across one chunk's URL. */
  function parseAhParams(url: string): Array<{ sku: string; qty: number }> {
    const params = new URL(url).searchParams.getAll('p')
    return params.map((p) => {
      const [sku, qty] = p.split(':')
      return { sku: sku!, qty: Number(qty) }
    })
  }

  /** Every `p=` token across ALL chunk URLs, flattened, in order. */
  function parseAllAhParams(
    urls: ReadonlyArray<string>,
  ): Array<{ sku: string; qty: number }> {
    return urls.flatMap(parseAhParams)
  }

  it('(a)+(b) every input SKU appears once with its merged qty', () => {
    const items = [
      { slug: 'wi415202/coconut', qty: 2 },
      { slug: 'wi2798', qty: 1 },
      { slug: 'wi555/rice', qty: 3 },
    ]
    const res = buildAllItemsCartUrl('ah', items)

    // The expected {sku, qty} set, derived independently via the public helpers.
    const expected = mergeCartLineItems(
      items.map((i) => ({ sku: ahProductId(i.slug)!, qty: i.qty })),
    )
    const expectedBySku = new Map(expected.map((e) => [e.sku, e.qty]))

    const parsed = parseAllAhParams(res.urls)
    const parsedBySku = new Map(parsed.map((p) => [p.sku, p.qty]))

    // (a) distinct SKU count matches the number of real-SKU input items.
    expect(parsed).toHaveLength(items.length)
    expect(parsedBySku.size).toBe(expectedBySku.size)
    expect([...parsedBySku.keys()].sort()).toEqual(
      [...expectedBySku.keys()].sort(),
    )
    // (b) each SKU's qty survives the round-trip exactly.
    for (const [sku, qty] of expectedBySku) {
      expect(parsedBySku.get(sku)).toBe(qty)
    }
    // matched == distinct real SKUs.
    expect(res.matched).toBe(expectedBySku.size)
  })

  it('(b) merges duplicate slugs into ONE SKU with summed qty', () => {
    // Same AH product reached via two slug spellings + a third line: the URL must
    // carry the product ONCE with the combined qty, never twice.
    const items = [
      { slug: 'wi415202/coconut', qty: 2 },
      { slug: '415202/coconut-grove', qty: 3 }, // same id 415202, no `wi`
      { slug: 'wi2798', qty: 1 },
    ]
    const res = buildAllItemsCartUrl('ah', items)
    const parsed = parseAllAhParams(res.urls)
    const bySku = new Map(parsed.map((p) => [p.sku, p.qty]))

    expect(bySku.size).toBe(2) // 415202 (merged) + 2798
    expect(bySku.get('415202')).toBe(5) // 2 + 3 summed
    expect(bySku.get('2798')).toBe(1)
    // The URL is the faithfulness contract: 2 distinct SKUs, never a dup. (`matched`
    // counts pre-merge SKU lines; the URL is what actually lands in AH.)
    const distinctInUrl = new Set(parsed.map((p) => p.sku)).size
    expect(distinctInUrl).toBe(2)
  })

  it('(a) null-slug items are excluded from the SKU count but counted in total', () => {
    const items = [
      { slug: 'wi415202/x', qty: 1 },
      { slug: null, qty: 4 },
      { slug: null },
      { slug: 'wi2798', qty: 2 },
    ]
    const res = buildAllItemsCartUrl('ah', items)
    const parsed = parseAllAhParams(res.urls)

    // Only the two real-SKU lines make it into the URL.
    expect(parsed).toHaveLength(2)
    expect(res.matched).toBe(2)
    expect(res.total).toBe(4) // null-slug lines still counted in the total
    expect(parsed.find((p) => p.sku === '415202')?.qty).toBe(1)
    expect(parsed.find((p) => p.sku === '2798')?.qty).toBe(2)
  })

  it('(c) chunks at ceil(skuCount / AH_BULK_CHUNK_SIZE), no chunk over the size', () => {
    // 44 distinct SKUs — the real-world failure scale. Every one must land in the
    // URL set exactly once; chunk count is exactly ceil(44/25) = 2.
    const skuCount = 44
    const items = Array.from({ length: skuCount }, (_, i) => ({
      slug: `wi${1000 + i}/p`,
      qty: 1,
    }))
    const res = buildAllItemsCartUrl('ah', items)

    expect(res.matched).toBe(skuCount)
    expect(res.urls).toHaveLength(Math.ceil(skuCount / AH_BULK_CHUNK_SIZE))
    // No single chunk exceeds the AH batch ceiling.
    for (const url of res.urls) {
      expect(parseAhParams(url).length).toBeLessThanOrEqual(AH_BULK_CHUNK_SIZE)
    }
    // The full round-trip: 44 in, 44 distinct SKUs out across the chunks.
    const parsed = parseAllAhParams(res.urls)
    expect(parsed).toHaveLength(skuCount)
    expect(new Set(parsed.map((p) => p.sku)).size).toBe(skuCount)
  })

  it('(d) an all-null-slug input yields zero URLs', () => {
    const res = buildAllItemsCartUrl('ah', [
      { slug: null },
      { slug: null, qty: 9 },
    ])
    expect(res.urls).toHaveLength(0)
    expect(res.url).toBeNull()
    expect(res.matched).toBe(0)
    expect(res.total).toBe(2)
  })
})
