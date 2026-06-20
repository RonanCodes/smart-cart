import { describe, it, expect, beforeEach } from 'vitest'
import {
  ANON_SWIPES_KEY,
  readAnonSwipes,
  writeAnonSwipes,
  clearAnonSwipes,
  dedupeByRecipe,
} from './anon-swipes'
import type { SwipeStorage } from './anon-swipes'

/** An in-memory Storage stub so the helpers run without the DOM. */
function memStorage(): SwipeStorage & { _map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    _map: map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('readAnonSwipes', () => {
  let store: ReturnType<typeof memStorage>
  beforeEach(() => {
    store = memStorage()
  })

  it('returns [] when nothing is stored', () => {
    expect(readAnonSwipes(store)).toEqual([])
  })

  it('returns [] for null storage (SSR)', () => {
    expect(readAnonSwipes(null)).toEqual([])
  })

  it('round-trips a written batch', () => {
    const swipes = [
      { recipeId: 'a', like: true },
      { recipeId: 'b', like: false },
    ]
    writeAnonSwipes(swipes, store)
    expect(readAnonSwipes(store)).toEqual(swipes)
  })

  it('returns [] for malformed JSON', () => {
    store.setItem(ANON_SWIPES_KEY, '{not json')
    expect(readAnonSwipes(store)).toEqual([])
  })

  it('returns [] when the stored value is not an array', () => {
    store.setItem(ANON_SWIPES_KEY, JSON.stringify({ recipeId: 'a' }))
    expect(readAnonSwipes(store)).toEqual([])
  })

  it('drops entries with the wrong shape', () => {
    store.setItem(
      ANON_SWIPES_KEY,
      JSON.stringify([
        { recipeId: 'a', like: true },
        { recipeId: 5, like: true },
        { like: false },
        'nope',
      ]),
    )
    expect(readAnonSwipes(store)).toEqual([{ recipeId: 'a', like: true }])
  })
})

describe('writeAnonSwipes', () => {
  it('is a no-op for null storage', () => {
    expect(() =>
      writeAnonSwipes([{ recipeId: 'a', like: true }], null),
    ).not.toThrow()
  })

  it('dedupes on write, latest decision wins', () => {
    const store = memStorage()
    writeAnonSwipes(
      [
        { recipeId: 'a', like: true },
        { recipeId: 'b', like: false },
        { recipeId: 'a', like: false },
      ],
      store,
    )
    expect(readAnonSwipes(store)).toEqual([
      { recipeId: 'a', like: false },
      { recipeId: 'b', like: false },
    ])
  })
})

describe('clearAnonSwipes', () => {
  it('removes the stored batch', () => {
    const store = memStorage()
    writeAnonSwipes([{ recipeId: 'a', like: true }], store)
    clearAnonSwipes(store)
    expect(readAnonSwipes(store)).toEqual([])
  })

  it('is a no-op for null storage', () => {
    expect(() => clearAnonSwipes(null)).not.toThrow()
  })
})

describe('dedupeByRecipe', () => {
  it('keeps first-seen order while taking the latest like', () => {
    expect(
      dedupeByRecipe([
        { recipeId: 'x', like: true },
        { recipeId: 'y', like: true },
        { recipeId: 'x', like: false },
      ]),
    ).toEqual([
      { recipeId: 'x', like: false },
      { recipeId: 'y', like: true },
    ])
  })

  it('returns [] for an empty input', () => {
    expect(dedupeByRecipe([])).toEqual([])
  })
})
