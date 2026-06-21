import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildDiscoverAngles,
  lovedCuisines,
  avoidClause,
  parseCards,
  fetchDiscoverCards,
} from './discover-core'
import type { DiscoverProfile } from './discover-core'

describe('lovedCuisines', () => {
  it('prefers the explicit cuisinesLiked list, title-cased', () => {
    const profile: DiscoverProfile = { cuisinesLiked: ['italian', 'THAI'] }
    expect(lovedCuisines(profile)).toEqual(['Italian', 'Thai'])
  })

  it('falls back to lovedTastes when cuisinesLiked is empty', () => {
    const profile: DiscoverProfile = {
      cuisinesLiked: [],
      lovedTastes: ['mexican'],
    }
    expect(lovedCuisines(profile)).toEqual(['Mexican'])
  })

  it('drops a loved cuisine that is also disliked, and de-dupes', () => {
    const profile: DiscoverProfile = {
      cuisinesLiked: ['Italian', 'italian', 'Thai'],
      dislikedCuisines: ['thai'],
    }
    expect(lovedCuisines(profile)).toEqual(['Italian'])
  })
})

describe('avoidClause', () => {
  it('lists the disliked ingredients to avoid', () => {
    expect(avoidClause({ dislikes: ['mushrooms', 'olives'] })).toBe(
      ' Avoid anything involving mushrooms, olives.',
    )
  })

  it('is empty when there are no dislikes', () => {
    expect(avoidClause({})).toBe('')
    expect(avoidClause({ dislikes: [] })).toBe('')
  })
})

describe('buildDiscoverAngles', () => {
  it('always includes in-season (with the month) + nutrition + fun-fact', () => {
    const angles = buildDiscoverAngles({}, 5 /* June */)
    const ids = angles.map((a) => a.id)
    expect(ids).toContain('in-season')
    expect(ids).toContain('nutrition')
    expect(ids).toContain('fun-fact')
    const inSeason = angles.find((a) => a.id === 'in-season')!
    expect(inSeason.query).toContain('Netherlands')
    expect(inSeason.query).toContain('June')
  })

  it('adds a cuisine spotlight only when a loved cuisine exists', () => {
    const without = buildDiscoverAngles({}, 0)
    expect(without.map((a) => a.id)).not.toContain('cuisine')

    const withLove = buildDiscoverAngles({ cuisinesLiked: ['Thai'] }, 0)
    const spotlight = withLove.find((a) => a.id === 'cuisine')!
    expect(spotlight).toBeDefined()
    expect(spotlight.title).toBe('Thai spotlight')
    expect(spotlight.query).toContain('Thai weeknight dinner dish')
  })

  it('ties the nutrition angle to the diet when one is set', () => {
    const angles = buildDiscoverAngles({ diet: 'vegetarian' }, 0)
    const nutrition = angles.find((a) => a.id === 'nutrition')!
    expect(nutrition.query).toContain('vegetarian diet')
  })

  it('NEVER names a disliked ingredient, and adds the avoid clause to every query', () => {
    const profile: DiscoverProfile = {
      cuisinesLiked: ['Italian'],
      dislikes: ['mushrooms', 'anchovies'],
    }
    const angles = buildDiscoverAngles(profile, 5)
    const clause = ' Avoid anything involving mushrooms, anchovies.'
    for (const a of angles) {
      // Every query carries the explicit avoid clause...
      expect(a.query).toContain(clause)
      // ...and the disliked ingredients appear ONLY inside that clause, never as
      // a positive subject of the question.
      const withoutClause = a.query.replace(clause, '')
      expect(withoutClause.toLowerCase()).not.toContain('mushrooms')
      expect(withoutClause.toLowerCase()).not.toContain('anchovies')
    }
  })
})

describe('parseCards', () => {
  it('parses a valid card array', () => {
    const json = JSON.stringify([
      { id: 'a', title: 'T', content: 'C', sources: [] },
    ])
    expect(parseCards(json)).toEqual([
      { id: 'a', title: 'T', content: 'C', sources: [] },
    ])
  })

  it('returns [] on malformed or non-array json', () => {
    expect(parseCards('not json')).toEqual([])
    expect(parseCards('{"x":1}')).toEqual([])
  })
})

// ---- fetchDiscoverCards: cache-first + key gating, with the server-only modules
// mocked exactly like recipe-facts-core.test.ts (D1, schema, env, Cala, auth). ----

let cachedRows: Array<{ cardsJson: string; generatedAt: Date }> = []
let householdRows: Array<{ id: string; profile: unknown }> = []
const insertValues = vi.fn()
const calaSearch = vi.fn()
let apiKey: string | undefined
let sessionUser: { id: string } | null = { id: 'u1' }

function buildFakeDb() {
  // A tiny chainable stub: select(...).from(...).where(...).limit(...) resolves to
  // the right rows for whichever table the call targets. We disambiguate by which
  // select shape was asked for (household selects { id, profile }).
  return {
    select: (shape?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            shape && 'profile' in shape ? householdRows : cachedRows,
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v)
        return { onConflictDoUpdate: async () => undefined }
      },
    }),
  }
}

vi.mock('./server-auth', () => ({ getSessionUser: async () => sessionUser }))
vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/schema', () => ({
  household: { id: 'hh-id', ownerId: 'hh-owner', profile: 'hh-profile' },
}))
vi.mock('../db/discover-cards-schema', () => ({
  discoverCards: {
    householdId: 'dc-household',
    cardsJson: 'dc-cards',
    generatedAt: 'dc-generated',
  },
}))
vi.mock('drizzle-orm', () => ({ eq: () => 'eq-clause' }))
vi.mock('./env', () => ({ readEnv: async () => apiKey }))
vi.mock('./cala', () => ({
  calaSearch: (i: string, k: string) => calaSearch(i, k),
}))

describe('fetchDiscoverCards', () => {
  beforeEach(() => {
    cachedRows = []
    householdRows = [{ id: 'hh1', profile: { cuisinesLiked: ['Italian'] } }]
    apiKey = 'clsk_test'
    sessionUser = { id: 'u1' }
    insertValues.mockReset()
    calaSearch.mockReset()
    calaSearch.mockResolvedValue({
      content: 'A fact.',
      sources: [{ name: 'Src', url: 'https://src.example' }],
    })
  })

  it('serves a fresh cache row without calling Cala', async () => {
    const cards = [
      { id: 'in-season', title: 'In season now', content: 'X', sources: [] },
    ]
    cachedRows = [{ cardsJson: JSON.stringify(cards), generatedAt: new Date() }]

    const res = await fetchDiscoverCards({ now: new Date() })

    expect(res).toEqual(cards)
    expect(calaSearch).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('regenerates when the cache row is older than the TTL', async () => {
    const stale = new Date('2026-06-01T00:00:00Z')
    const now = new Date('2026-06-10T00:00:00Z') // 9 days later, well past 24h
    cachedRows = [
      {
        cardsJson: JSON.stringify([
          { id: 'old', title: 'Old', content: 'old', sources: [] },
        ]),
        generatedAt: stale,
      },
    ]

    const res = await fetchDiscoverCards({ now })

    expect(calaSearch).toHaveBeenCalled()
    expect(res.length).toBeGreaterThan(0)
    expect(insertValues).toHaveBeenCalledOnce()
  })

  it('calls Cala on a cache miss, assembles + caches cards, and returns them', async () => {
    cachedRows = []

    const res = await fetchDiscoverCards({ now: new Date('2026-06-15') })

    // One call per built angle (Italian profile -> in-season, nutrition, cuisine, fun-fact).
    expect(calaSearch).toHaveBeenCalledTimes(4)
    expect(res.length).toBe(4)
    expect(res[0]).toMatchObject({
      title: 'In season now',
      content: 'A fact.',
    })
    expect(insertValues).toHaveBeenCalledOnce()
  })

  it('returns [] and never calls Cala when the key is unconfigured', async () => {
    cachedRows = []
    apiKey = undefined

    const res = await fetchDiscoverCards({ now: new Date() })

    expect(res).toEqual([])
    expect(calaSearch).not.toHaveBeenCalled()
  })

  it('returns [] without caching when every Cala query fails', async () => {
    cachedRows = []
    calaSearch.mockRejectedValue(new Error('boom'))

    const res = await fetchDiscoverCards({ now: new Date() })

    expect(res).toEqual([])
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('returns [] when the user is not signed in', async () => {
    sessionUser = null

    const res = await fetchDiscoverCards({ now: new Date() })

    expect(res).toEqual([])
    expect(calaSearch).not.toHaveBeenCalled()
  })
})
