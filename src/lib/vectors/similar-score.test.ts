import { describe, expect, it } from 'vitest'
import { rankBySimilarity, tokenize } from './similar-score'
import type { ScorableRecipe } from './similar-score'

const r = (
  id: string,
  title: string,
  cuisine: string | null,
  ingredients: Array<string>,
): ScorableRecipe => ({
  id,
  title,
  cuisine,
  ingredients: ingredients.map((name) => ({ name })),
})

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumeric, drops short tokens', () => {
    const t = tokenize('Spaghetti Bolognese, al dente!')
    expect(t.has('spaghetti')).toBe(true)
    expect(t.has('bolognese')).toBe(true)
    expect(t.has('dente')).toBe(true)
    expect(t.has('al')).toBe(false) // < 3 chars
  })
  it('keeps accented / non-ASCII letters (Dutch)', () => {
    expect(tokenize('Boerenkool stamppot met rookworst').has('rookworst')).toBe(
      true,
    )
  })
})

describe('rankBySimilarity', () => {
  const query = r('q', 'Chicken Tikka Masala', 'indian', [
    'chicken',
    'tikka paste',
    'tomato',
    'cream',
  ])
  const candidates: Array<ScorableRecipe> = [
    r('near', 'Chicken Curry', 'indian', [
      'chicken',
      'curry',
      'tomato',
      'cream',
    ]),
    r('cuisine-only', 'Dal Tadka', 'indian', ['lentils', 'cumin', 'onion']),
    r('far', 'Pancakes', 'american', ['flour', 'egg', 'milk', 'syrup']),
  ]

  it('ranks the most ingredient-overlapping recipe first', () => {
    const out = rankBySimilarity(query, candidates, 3)
    expect(out[0]!.id).toBe('near')
  })

  it('ranks an unrelated recipe last with a low score', () => {
    const out = rankBySimilarity(query, candidates, 3)
    expect(out[out.length - 1]!.id).toBe('far')
    expect(out[out.length - 1]!.score).toBeLessThan(out[0]!.score)
  })

  it('gives a same-cuisine recipe a boost over a no-overlap other-cuisine one', () => {
    const out = rankBySimilarity(query, candidates, 3)
    const cuisineOnly = out.find((n) => n.id === 'cuisine-only')!
    const far = out.find((n) => n.id === 'far')!
    expect(cuisineOnly.score).toBeGreaterThan(far.score)
  })

  it('scores an identical recipe at the top (~1)', () => {
    const out = rankBySimilarity(
      query,
      [
        r('self', 'Chicken Tikka Masala', 'indian', [
          'chicken',
          'tikka paste',
          'tomato',
          'cream',
        ]),
      ],
      1,
    )
    expect(out[0]!.id).toBe('self')
    expect(out[0]!.score).toBeGreaterThan(0.9)
  })

  it('honours topK', () => {
    expect(rankBySimilarity(query, candidates, 2)).toHaveLength(2)
  })
})
