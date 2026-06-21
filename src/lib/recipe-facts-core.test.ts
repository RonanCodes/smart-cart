import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRecipeFacts, buildFactsQuestion } from './recipe-facts-core'

// Mocks for the server-only modules getRecipeFacts imports dynamically: D1, the
// split schema table, the env accessor, and the Cala client. We control each so
// the test asserts the cache-first behaviour without touching D1 or the network.

let cachedRows: Array<{ content: string; sourcesJson: string }> = []
const insertValues = vi.fn()

function buildFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => cachedRows,
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValues(v)
        return { onConflictDoNothing: async () => undefined }
      },
    }),
  }
}

const calaSearch = vi.fn()
let apiKey: string | undefined

vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/recipe-facts-schema', () => ({
  recipeFacts: {
    recipeId: 'recipe-id-col',
    content: 'content-col',
    sourcesJson: 'sources-col',
  },
}))
vi.mock('drizzle-orm', () => ({ eq: () => 'eq-clause' }))
vi.mock('./env', () => ({ readEnv: async () => apiKey }))
vi.mock('./cala', () => ({
  calaSearch: (i: string, k: string) => calaSearch(i, k),
}))

const input = { recipeId: 'r1', title: 'Stamppot', cuisine: 'Dutch' }

describe('buildFactsQuestion', () => {
  it('weaves the dish + cuisine in and nudges Netherlands seasonality', () => {
    const q = buildFactsQuestion('Stamppot', 'Dutch')
    expect(q).toContain("'Stamppot (Dutch)'")
    expect(q).toContain('Netherlands seasonality')
  })

  it('omits the cuisine parens when none is given', () => {
    expect(buildFactsQuestion('Stamppot')).toContain("'Stamppot'")
  })
})

describe('getRecipeFacts', () => {
  beforeEach(() => {
    cachedRows = []
    apiKey = 'clsk_test'
    calaSearch.mockReset()
    insertValues.mockReset()
  })

  it('serves from the cache without calling Cala when a row exists', async () => {
    cachedRows = [
      {
        content: 'Cached fact.',
        sourcesJson: JSON.stringify([
          { name: 'Src', url: 'https://src.example' },
        ]),
      },
    ]

    const res = await fetchRecipeFacts(input)

    expect(res).toEqual({
      content: 'Cached fact.',
      sources: [{ name: 'Src', url: 'https://src.example' }],
    })
    expect(calaSearch).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('calls Cala on a cache miss, stores the result, and returns it', async () => {
    cachedRows = []
    calaSearch.mockResolvedValue({
      content: 'Fresh fact.',
      sources: [{ name: 'Web', url: 'https://web.example' }],
    })

    const res = await fetchRecipeFacts(input)

    expect(calaSearch).toHaveBeenCalledOnce()
    expect(res).toEqual({
      content: 'Fresh fact.',
      sources: [{ name: 'Web', url: 'https://web.example' }],
    })
    // It cached the answer (so a second call serves from the cache).
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeId: 'r1',
        content: 'Fresh fact.',
        sourcesJson: JSON.stringify([
          { name: 'Web', url: 'https://web.example' },
        ]),
      }),
    )
  })

  it('returns {content:null} and never calls Cala when the key is unconfigured', async () => {
    cachedRows = []
    apiKey = undefined

    const res = await fetchRecipeFacts(input)

    expect(res).toEqual({ content: null, sources: [] })
    expect(calaSearch).not.toHaveBeenCalled()
  })

  it('degrades to {content:null} when Cala throws (no crash)', async () => {
    cachedRows = []
    calaSearch.mockRejectedValue(new Error('boom'))

    const res = await fetchRecipeFacts(input)

    expect(res).toEqual({ content: null, sources: [] })
    expect(insertValues).not.toHaveBeenCalled()
  })
})
