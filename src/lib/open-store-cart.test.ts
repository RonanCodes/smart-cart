import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildAllItemsCartUrl } from './cart-build'
import { AH_BULK_CHUNK_SIZE } from './cart-links'
import {
  openStoreCart,
  CART_CHUNK_OPEN_MS,
  CART_CHUNK_OPEN_BUFFER_MS,
  cartChunkOpenDelayMs,
} from './open-store-cart'

describe('cartChunkOpenDelayMs', () => {
  it('returns 0 for a single chunk', () => {
    expect(cartChunkOpenDelayMs(0)).toBe(0)
    expect(cartChunkOpenDelayMs(1)).toBe(0)
  })

  it('waits through every stagger slot plus a settle buffer', () => {
    expect(cartChunkOpenDelayMs(2)).toBe(
      CART_CHUNK_OPEN_MS + CART_CHUNK_OPEN_BUFFER_MS,
    )
    expect(cartChunkOpenDelayMs(3)).toBe(
      2 * CART_CHUNK_OPEN_MS + CART_CHUNK_OPEN_BUFFER_MS,
    )
    // 44 SKUs → 2 chunks (AH_BULK_CHUNK_SIZE = 25)
    expect(cartChunkOpenDelayMs(Math.ceil(44 / AH_BULK_CHUNK_SIZE))).toBe(
      CART_CHUNK_OPEN_MS + CART_CHUNK_OPEN_BUFFER_MS,
    )
  })
})

describe('openStoreCart', () => {
  const opened: Array<{ url: string; at: number }> = []
  const tabs: Array<{ href: string; closed: boolean }> = []
  let openMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    opened.length = 0
    tabs.length = 0
    vi.useFakeTimers()
    openMock = vi.fn((_url: string) => {
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
    })
    vi.stubGlobal('open', openMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is a no-op when there are no chunk URLs', () => {
    openStoreCart({
      store: 'ah',
      url: null,
      urls: [],
      matched: 0,
      total: 0,
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('opens one tab with noopener for a single-chunk cart', () => {
    const url = 'https://www.ah.nl/mijnlijst/add-multiple?p=1:1'
    openStoreCart({
      store: 'ah',
      url,
      urls: [url],
      matched: 1,
      total: 1,
    })
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    expect(opened).toHaveLength(0)
  })

  it('reserves about:blank tabs without noopener so handles stay navigable', () => {
    const urls = [
      'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
      'https://www.ah.nl/mijnlijst/add-multiple?p=2:1',
    ]
    openStoreCart({
      store: 'ah',
      url: urls[1]!,
      urls,
      matched: 2,
      total: 2,
    })

    expect(openMock).toHaveBeenCalledTimes(2)
    for (const call of openMock.mock.calls) {
      expect(call[0]).toBe('about:blank')
      expect(call[1]).toBe('_blank')
      expect(call).toHaveLength(2)
    }
  })

  it('staggers multi-chunk navigations at CART_CHUNK_OPEN_MS intervals', () => {
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

    expect(opened).toHaveLength(1)
    expect(opened[0]!.url).toBe(urls[0])

    vi.advanceTimersByTime(CART_CHUNK_OPEN_MS - 1)
    expect(opened).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(opened).toHaveLength(2)
    expect(opened[1]!.url).toBe(urls[1])

    vi.advanceTimersByTime(CART_CHUNK_OPEN_MS)
    expect(opened).toHaveLength(3)
    expect(opened[2]!.url).toBe(urls[2])
  })

  it('does not navigate closed or null tab handles', () => {
    openMock.mockImplementationOnce(() => null)
    openMock.mockImplementationOnce(() => {
      const state = { href: '', closed: true }
      return {
        get closed() {
          return state.closed
        },
        location: { href: state.href },
      }
    })
    openMock.mockImplementationOnce(() => {
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
      }
    })

    const urls = ['https://a', 'https://b', 'https://c']
    openStoreCart({
      store: 'ah',
      url: urls[2]!,
      urls,
      matched: 3,
      total: 3,
    })

    expect(opened).toHaveLength(0)
    vi.advanceTimersByTime(2 * CART_CHUNK_OPEN_MS)
    expect(opened).toHaveLength(1)
    expect(opened[0]!.url).toBe('https://c')
  })
})

describe('chunked cart build → openStoreCart', () => {
  const opened: string[] = []
  let openMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    opened.length = 0
    vi.useFakeTimers()
    openMock = vi.fn((_url: string) => {
      const state = { href: '', closed: false }
      return {
        get closed() {
          return state.closed
        },
        location: {
          set href(v: string) {
            state.href = v
            opened.push(v)
          },
          get href() {
            return state.href
          },
        },
      } as unknown as Window
    })
    vi.stubGlobal('open', openMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens every chunk URL for a 44-item AH cart with correct stagger timing', () => {
    const items = Array.from({ length: 44 }, (_, i) => ({
      slug: `wi${1000 + i}/p`,
      qty: 1,
    }))
    const built = buildAllItemsCartUrl('ah', items)
    expect(built.urls).toHaveLength(Math.ceil(44 / AH_BULK_CHUNK_SIZE))

    openStoreCart(built)
    expect(openMock).toHaveBeenCalledTimes(built.urls.length)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toBe(built.urls[0])

    vi.advanceTimersByTime(cartChunkOpenDelayMs(built.urls.length))
    expect(opened).toEqual(built.urls)
  })
})
