import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapRecipeDetail,
  formatAmount,
  fetchRecipeDetail,
} from './recipe-detail-core'

describe('formatAmount', () => {
  it('joins qty + unit', () => {
    expect(formatAmount('500', 'g')).toBe('500 g')
  })
  it('falls back to qty alone, unit alone, or null', () => {
    expect(formatAmount('2')).toBe('2')
    expect(formatAmount(undefined, 'snufje')).toBe('snufje')
    expect(formatAmount()).toBeNull()
    expect(formatAmount('  ', '  ')).toBeNull()
  })
})

describe('mapRecipeDetail — the recipe row -> {ingredients, steps}', () => {
  it('maps real ingredients (qty + unit) and steps from the row', () => {
    const result = mapRecipeDetail({
      ingredients: [
        { name: 'aardappelen', qty: '500', unit: 'g', productId: 'p1' },
        { name: 'ui', qty: '1' },
        { name: 'zout', unit: 'snufje' },
      ],
      instructions: ['Kook de aardappelen.', 'Snijd de ui.'],
      prepMinutes: 25,
      servings: 4,
    })

    expect(result).toEqual({
      ingredients: [
        { name: 'aardappelen', amount: '500 g' },
        { name: 'ui', amount: '1' },
        { name: 'zout', amount: 'snufje' },
      ],
      steps: ['Kook de aardappelen.', 'Snijd de ui.'],
      prepMinutes: 25,
      servings: 4,
    })
  })

  it('drops nameless ingredients and blank/whitespace steps, trims both', () => {
    const result = mapRecipeDetail({
      ingredients: [
        { name: '  pasta  ', qty: '200', unit: 'g' },
        { name: '', qty: '1' },
        { name: '   ', qty: '2' },
      ],
      instructions: ['  Boil water.  ', '', '   ', 'Add pasta.'],
      prepMinutes: 15,
      servings: 2,
    })

    expect(result.ingredients).toEqual([{ name: 'pasta', amount: '200 g' }])
    expect(result.steps).toEqual(['Boil water.', 'Add pasta.'])
  })

  it('returns empty arrays for an empty recipe (null JSON columns)', () => {
    expect(
      mapRecipeDetail({
        ingredients: null,
        instructions: null,
        prepMinutes: null,
        servings: null,
      }),
    ).toEqual({ ingredients: [], steps: [], prepMinutes: null, servings: null })
  })

  it('returns empty arrays when the row has empty arrays', () => {
    expect(
      mapRecipeDetail({
        ingredients: [],
        instructions: [],
        prepMinutes: 10,
        servings: 1,
      }),
    ).toEqual({ ingredients: [], steps: [], prepMinutes: 10, servings: 1 })
  })
})

// fetchRecipeDetail: the server-only deps (auth, D1, schema, drizzle) are
// dynamic-imported, so we mock each to prove the gate + the missing-row path
// without standing up the Start runtime / a live DB.

let detailRows: Array<unknown> = []
let sessionUser: { id: string } | null = { id: 'u1' }

function buildFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => detailRows,
        }),
      }),
    }),
  }
}

vi.mock('./server-auth', () => ({ getSessionUser: async () => sessionUser }))
vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/schema', () => ({
  recipe: {
    id: 'id-col',
    ingredients: 'ingredients-col',
    instructions: 'instructions-col',
    prepMinutes: 'prep-col',
    servings: 'servings-col',
  },
}))
vi.mock('drizzle-orm', () => ({ eq: () => 'eq-clause' }))

describe('fetchRecipeDetail', () => {
  beforeEach(() => {
    detailRows = []
    sessionUser = { id: 'u1' }
  })

  it('maps the recipe row into the clean detail', async () => {
    detailRows = [
      {
        ingredients: [{ name: 'rijst', qty: '300', unit: 'g' }],
        instructions: ['Spoel de rijst.'],
        prepMinutes: 20,
        servings: 3,
      },
    ]

    const res = await fetchRecipeDetail({ recipeId: 'r1' })

    expect(res).toEqual({
      ingredients: [{ name: 'rijst', amount: '300 g' }],
      steps: ['Spoel de rijst.'],
      prepMinutes: 20,
      servings: 3,
    })
  })

  it('returns empty arrays when the recipe is not found', async () => {
    detailRows = []

    const res = await fetchRecipeDetail({ recipeId: 'missing' })

    expect(res).toEqual({
      ingredients: [],
      steps: [],
      prepMinutes: null,
      servings: null,
    })
  })

  it('returns empty arrays for a blank recipeId without touching the db', async () => {
    const res = await fetchRecipeDetail({ recipeId: '' })
    expect(res).toEqual({
      ingredients: [],
      steps: [],
      prepMinutes: null,
      servings: null,
    })
  })

  it('throws when no user is signed in (household gate)', async () => {
    sessionUser = null
    await expect(fetchRecipeDetail({ recipeId: 'r1' })).rejects.toThrow(
      'Not signed in',
    )
  })
})
