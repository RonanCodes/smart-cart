import { describe, expect, it } from 'vitest'
import { rankBySimilarity } from './similar-score'
import type { ScorableRecipe, VectorIndex } from './similar-score'

/**
 * The scorer now ranks by cosine over a precomputed vector index (ADR-0004), so the
 * tests hand it synthetic vectors and assert the cosine ordering. No DB, no embed
 * call. The same-cuisine boost only breaks near-ties, so the vectors carry the real
 * signal.
 */

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

/** Build a vector index from id -> vector pairs. */
function index(...pairs: Array<[string, Array<number>]>): VectorIndex {
  return new Map(pairs)
}

describe('rankBySimilarity (cosine)', () => {
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

  // Synthetic 3-d vectors. 'near' points almost exactly at the query, 'cuisine-only'
  // is roughly orthogonal but slightly aligned, 'far' is nearly opposite.
  const vectors = index(
    ['q', [1, 0, 0]],
    ['near', [0.98, 0.2, 0]],
    ['cuisine-only', [0.2, 0.97, 0]],
    ['far', [-0.9, 0.1, 0.4]],
  )

  it('ranks the most cosine-similar recipe first', () => {
    const out = rankBySimilarity(query, candidates, vectors, 3)
    expect(out[0]!.id).toBe('near')
  })

  it('ranks an unrelated recipe last with a low score', () => {
    const out = rankBySimilarity(query, candidates, vectors, 3)
    expect(out[out.length - 1]!.id).toBe('far')
    expect(out[out.length - 1]!.score).toBeLessThan(out[0]!.score)
  })

  it('a same-cuisine recipe outranks a no-overlap other-cuisine one', () => {
    const out = rankBySimilarity(query, candidates, vectors, 3)
    const cuisineOnly = out.find((n) => n.id === 'cuisine-only')!
    const far = out.find((n) => n.id === 'far')!
    expect(cuisineOnly.score).toBeGreaterThan(far.score)
  })

  it('scores an identical-vector recipe at the top (~1)', () => {
    const self = r('self', 'Chicken Tikka Masala', 'indian', [
      'chicken',
      'tikka paste',
      'tomato',
      'cream',
    ])
    const out = rankBySimilarity(
      query,
      [self],
      index(['q', [1, 0, 0]], ['self', [1, 0, 0]]),
      1,
    )
    expect(out[0]!.id).toBe('self')
    expect(out[0]!.score).toBeGreaterThan(0.9)
  })

  it('ranks a cross-language neighbour that shares no tokens', () => {
    // English query, Dutch candidate. Token overlap would be ~0; the embedding
    // vectors are near each other, so cosine ranks it top. This is the pivot's
    // whole point: semantic, not lexical, similarity.
    const en = r('en', 'Mushroom risotto', 'italian', ['mushroom', 'rice'])
    const nlNear = r('nl-near', 'Champignonrisotto', 'italiaans', [
      'champignon',
      'rijst',
    ])
    const unrelated = r('nl-far', 'Appeltaart', 'hollands', ['appel', 'deeg'])
    const out = rankBySimilarity(
      en,
      [nlNear, unrelated],
      index(
        ['en', [1, 0.1, 0]],
        ['nl-near', [0.95, 0.2, 0.05]],
        ['nl-far', [-0.3, 0.9, 0.2]],
      ),
      2,
    )
    expect(out[0]!.id).toBe('nl-near')
  })

  it('skips a candidate with no vector', () => {
    const out = rankBySimilarity(
      query,
      candidates,
      index(['q', [1, 0, 0]], ['near', [0.98, 0.2, 0]]),
      3,
    )
    // Only 'near' has a vector; 'cuisine-only' and 'far' are unscoreable.
    expect(out.map((n) => n.id)).toEqual(['near'])
  })

  it('returns nothing when the query has no vector', () => {
    const out = rankBySimilarity(
      query,
      candidates,
      index(['near', [1, 0, 0]]),
      3,
    )
    expect(out).toEqual([])
  })

  it('honours topK', () => {
    expect(rankBySimilarity(query, candidates, vectors, 2)).toHaveLength(2)
  })
})
