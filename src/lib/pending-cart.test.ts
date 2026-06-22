import { describe, it, expect, beforeEach } from 'vitest'
import {
  isOpenableCartLink,
  stashPendingCart,
  takePendingCart,
} from './pending-cart'
import type { BuiltCartLink } from './cart-build'

const link: BuiltCartLink = {
  store: 'ah',
  url: 'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
  urls: ['https://www.ah.nl/mijnlijst/add-multiple?p=1:1'],
  matched: 1,
  total: 1,
}

describe('pending-cart', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('isOpenableCartLink accepts a built link with urls', () => {
    expect(isOpenableCartLink(link)).toBe(true)
  })

  it('isOpenableCartLink rejects empty urls', () => {
    expect(isOpenableCartLink({ ...link, urls: [] })).toBe(false)
  })

  it('stash then take returns the same link once', () => {
    stashPendingCart('tip-abc', link)
    expect(takePendingCart('tip-abc')).toEqual(link)
    expect(takePendingCart('tip-abc')).toBeNull()
  })

  it('take returns null for an unknown tip id', () => {
    expect(takePendingCart('missing')).toBeNull()
  })
})
