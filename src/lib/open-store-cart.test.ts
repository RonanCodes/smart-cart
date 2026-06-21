import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openStoreCart, CART_CHUNK_OPEN_MS } from './open-store-cart'

describe('openStoreCart', () => {
  const opened: Array<{ url: string; at: number }> = []
  const tabs: Array<{ href: string; closed: boolean }> = []

  beforeEach(() => {
    opened.length = 0
    tabs.length = 0
    vi.useFakeTimers()
    vi.stubGlobal(
      'open',
      vi.fn((_url: string) => {
        const state = { href: '', closed: false }
        tabs.push(state)
        return {
          get closed() {
            return state.closed
          },
          location: {
            get href() {
              return state.href
            },
            set href(v: string) {
              state.href = v
              opened.push({ url: v, at: Date.now() })
            },
          },
        } as unknown as Window
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response())),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens one tab for a single-chunk cart', () => {
    const url = 'https://www.ah.nl/mijnlijst/add-multiple?p=1:1'
    openStoreCart({
      store: 'ah',
      url,
      urls: [url],
      matched: 1,
      total: 1,
    })
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  })

  it('staggers multi-chunk navigations', () => {
    const urls = [
      'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
      'https://www.ah.nl/mijnlijst/add-multiple?p=2:1',
      'https://www.ah.nl/mijnlijst/add-multiple?p=3:1',
    ]
    openStoreCart({
      store: 'ah',
      url: urls[2]!,
      urls,
      matched: 3,
      total: 3,
    })

    expect(open).toHaveBeenCalledTimes(3)
    expect(opened).toHaveLength(1)
    expect(opened[0]!.url).toBe(urls[0])

    vi.advanceTimersByTime(CART_CHUNK_OPEN_MS)
    expect(opened).toHaveLength(2)
    expect(opened[1]!.url).toBe(urls[1])

    vi.advanceTimersByTime(CART_CHUNK_OPEN_MS)
    expect(opened).toHaveLength(3)
    expect(opened[2]!.url).toBe(urls[2])
  })
})
