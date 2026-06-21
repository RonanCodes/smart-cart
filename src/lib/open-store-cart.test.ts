import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openStoreCart } from './open-store-cart'

describe('openStoreCart', () => {
  const opened: Array<string> = []

  beforeEach(() => {
    opened.length = 0
    vi.stubGlobal(
      'open',
      vi.fn((url: string) => {
        opened.push(url)
        return null
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens preload chunks then the last URL in focus', () => {
    openStoreCart({
      store: 'ah',
      url: 'https://www.ah.nl/mijnlijst/add-multiple?p=3:1',
      urls: [
        'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
        'https://www.ah.nl/mijnlijst/add-multiple?p=2:1',
        'https://www.ah.nl/mijnlijst/add-multiple?p=3:1',
      ],
      matched: 3,
      total: 3,
    })
    expect(opened).toEqual([
      'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
      'https://www.ah.nl/mijnlijst/add-multiple?p=2:1',
      'https://www.ah.nl/mijnlijst/add-multiple?p=3:1',
    ])
  })

  it('chunks Jumbo mandje links the same way', () => {
    openStoreCart({
      store: 'jumbo',
      url: 'https://www.jumbo.com/mandje/?add=chunk2',
      urls: [
        'https://www.jumbo.com/mandje/?add=chunk1',
        'https://www.jumbo.com/mandje/?add=chunk2',
      ],
      matched: 2,
      total: 2,
    })
    expect(opened).toEqual([
      'https://www.jumbo.com/mandje/?add=chunk1',
      'https://www.jumbo.com/mandje/?add=chunk2',
    ])
  })
})
