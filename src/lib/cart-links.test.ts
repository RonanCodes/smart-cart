import { describe, it, expect } from 'vitest'
import {
  ahProductId,
  jumboSku,
  ahBulkCartUrl,
  jumboBulkCartUrl,
} from './cart-links'

describe('ahProductId', () => {
  it('strips the leading wi and the slug tail', () => {
    expect(ahProductId('wi415202/100-coconut-grove')).toBe('415202')
  })

  it('handles a slug with no tail', () => {
    expect(ahProductId('wi2798')).toBe('2798')
  })

  it('leaves a numeric-only head untouched', () => {
    expect(ahProductId('415202/foo')).toBe('415202')
  })

  it('returns null for empty / nullish slugs', () => {
    expect(ahProductId(null)).toBeNull()
    expect(ahProductId(undefined)).toBeNull()
    expect(ahProductId('')).toBeNull()
    expect(ahProductId('wi')).toBeNull()
  })
})

describe('jumboSku', () => {
  it('takes the trailing dash token', () => {
    expect(jumboSku('11er-spek-rosti-350-g-128692ZK')).toBe('128692ZK')
    expect(jumboSku('1fruit-appel-200ml-764448PAK')).toBe('764448PAK')
  })

  it('returns the whole string when there is no dash', () => {
    expect(jumboSku('128692ZK')).toBe('128692ZK')
  })

  it('returns null for empty / nullish slugs', () => {
    expect(jumboSku(null)).toBeNull()
    expect(jumboSku(undefined)).toBeNull()
    expect(jumboSku('   ')).toBeNull()
  })
})

describe('ahBulkCartUrl', () => {
  it('builds one p= param per item with sku:qty', () => {
    const url = ahBulkCartUrl([
      { sku: '415202', qty: 2 },
      { sku: '2798', qty: 1 },
    ])
    expect(url).toBe(
      'https://www.ah.nl/mijnlijst/add-multiple?p=415202:2&p=2798:1',
    )
  })

  it('clamps qty to 1..99 and rounds', () => {
    expect(ahBulkCartUrl([{ sku: '1', qty: 0 }])).toContain('p=1:1')
    expect(ahBulkCartUrl([{ sku: '1', qty: -5 }])).toContain('p=1:1')
    expect(ahBulkCartUrl([{ sku: '1', qty: 250 }])).toContain('p=1:99')
    expect(ahBulkCartUrl([{ sku: '1', qty: 2.6 }])).toContain('p=1:3')
  })

  it('drops empty SKUs and returns null when nothing remains', () => {
    expect(
      ahBulkCartUrl([
        { sku: '', qty: 1 },
        { sku: '   ', qty: 1 },
      ]),
    ).toBeNull()
    expect(ahBulkCartUrl([])).toBeNull()
  })
})

describe('jumboBulkCartUrl', () => {
  it('builds a URL-encoded JSON [{sku, quantity}] add param', () => {
    const url = jumboBulkCartUrl([
      { sku: '128692ZK', qty: 2 },
      { sku: '764448PAK', qty: 1 },
    ])
    expect(url).not.toBeNull()
    const u = new URL(url!)
    expect(u.origin + u.pathname).toBe('https://www.jumbo.com/mandje/')
    const add = u.searchParams.get('add')
    expect(add).not.toBeNull()
    expect(JSON.parse(add!)).toEqual([
      { sku: '128692ZK', quantity: 2 },
      { sku: '764448PAK', quantity: 1 },
    ])
  })

  it('clamps qty to 1..99', () => {
    const url = jumboBulkCartUrl([{ sku: 'X', qty: 1000 }])
    const add = new URL(url!).searchParams.get('add')!
    expect(JSON.parse(add)).toEqual([{ sku: 'X', quantity: 99 }])
  })

  it('drops empty SKUs and returns null when nothing remains', () => {
    expect(jumboBulkCartUrl([{ sku: ' ', qty: 1 }])).toBeNull()
    expect(jumboBulkCartUrl([])).toBeNull()
  })
})
