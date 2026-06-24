import { describe, expect, it } from 'vitest'
import {
  orderBarCounts,
  orderBarHeadline,
  storeWithArticle,
} from './order-bar-counts'
import type { StoreBasket } from '#/lib/pricing'

function basket(matched: number, unmatched: number): StoreBasket {
  return {
    store: 'ah',
    displayName: 'Albert Heijn',
    lineItems: Array.from({ length: matched }, (_, i) => ({
      ingredient: `item-${i}`,
      productName: 'p',
      packSize: '1',
      packPriceCents: 100,
      packs: 1,
      lineCents: 100,
      slug: null,
      confidence: 'high' as const,
      estimated: false,
      waste: null,
    })),
    totalCents: matched * 100,
    totalWaste: {
      cents: 0,
      massGrams: 0,
      volumeMl: 0,
      count: 0,
      unknownLines: 0,
      hasUnknown: false,
    },
    unavailable: Array.from({ length: unmatched }, (_, i) => ({
      ingredient: `missing-${i}`,
    })),
    estimatedCount: 0,
  }
}

describe('orderBarCounts', () => {
  it('uses the price basket when the cart link has not built yet', () => {
    expect(orderBarCounts(46, basket(42, 4), null)).toEqual({
      total: 46,
      matched: 42,
    })
  })

  it('prefers the cart-link build once the order flow resolves it', () => {
    expect(
      orderBarCounts(46, basket(40, 6), {
        store: 'ah',
        url: 'https://ah.nl',
        urls: ['https://ah.nl'],
        matched: 42,
        total: 46,
      }),
    ).toEqual({ total: 46, matched: 42 })
  })
})

describe('orderBarHeadline', () => {
  it('shows partial match in the headline instead of claiming every item matched', () => {
    expect(orderBarHeadline({ total: 46, matched: 42 }, 'Albert Heijn')).toBe(
      '42 of 46 items matched at Albert Heijn',
    )
  })

  it('shows the simple total when everything matched', () => {
    expect(orderBarHeadline({ total: 3, matched: 3 }, 'Jumbo')).toBe(
      '3 items at Jumbo',
    )
  })
})

describe('storeWithArticle', () => {
  it('uses "an" before Albert Heijn', () => {
    expect(storeWithArticle('Albert Heijn')).toBe('an Albert Heijn')
  })

  it('uses "a" before Jumbo', () => {
    expect(storeWithArticle('Jumbo')).toBe('a Jumbo')
  })
})
