import { describe, expect, it } from 'vitest'
import {
  buildTermMatcher,
  buildTermMatcherLive,
  combineTermMatchers,
  substringTermMatcher,
} from './term-match'
import type { PlannerRecipe } from '../planner/types'

/**
 * Unit tests for the embedding term-matcher (ADR-0004). The cosine maths takes the
 * term vector + the recipe vector index as inputs, so it is tested offline with
 * synthetic vectors. No embed call, no DB.
 */

function recipe(id: string): PlannerRecipe {
  return {
    id,
    title: id,
    cuisine: null,
    category: 'Main',
    mealType: 'dinner',
    dietaryTags: [],
    ingredients: [],
    calories: 0,
    protein: 0,
    prepMinutes: 0,
  }
}

describe('buildTermMatcher', () => {
  it('matches a recipe whose vector is near the term vector', () => {
    const vectors = new Map<string, ReadonlyArray<number>>([
      ['near', [0.96, 0.2, 0]],
      ['far', [-0.5, 0.8, 0.3]],
    ])
    const matches = buildTermMatcher([1, 0, 0], vectors)
    expect(matches(recipe('near'))).toBe(true)
    expect(matches(recipe('far'))).toBe(false)
  })

  it('matches a cross-language neighbour with no shared tokens', () => {
    // The English term "mushroom" and a Dutch "champignonrisotto" share no tokens,
    // but their vectors are near each other, so cosine matches. This is what the
    // synonym table used to do by hand.
    const vectors = new Map<string, ReadonlyArray<number>>([
      ['champignonrisotto', [0.9, 0.3, 0.1]],
      ['appeltaart', [0.1, 0.1, 0.99]],
    ])
    const matches = buildTermMatcher([0.95, 0.25, 0], vectors)
    expect(matches(recipe('champignonrisotto'))).toBe(true)
    expect(matches(recipe('appeltaart'))).toBe(false)
  })

  it('never matches a recipe with no vector', () => {
    const matches = buildTermMatcher([1, 0, 0], new Map())
    expect(matches(recipe('x'))).toBe(false)
  })

  it('honours a custom threshold', () => {
    const vectors = new Map<string, ReadonlyArray<number>>([
      ['mid', [0.7, 0.7, 0]],
    ])
    // cosine ~= 0.707. Below a strict 0.8 threshold, above a loose 0.5 one.
    expect(buildTermMatcher([1, 0, 0], vectors, 0.8)(recipe('mid'))).toBe(false)
    expect(buildTermMatcher([1, 0, 0], vectors, 0.5)(recipe('mid'))).toBe(true)
  })
})

describe('buildTermMatcherLive', () => {
  it('embeds the term once then builds the matcher', async () => {
    let calls = 0
    const embed = async (text: string) => {
      calls++
      expect(text).toBe('mushroom')
      return [1, 0, 0]
    }
    const vectors = new Map<string, ReadonlyArray<number>>([
      ['m', [0.95, 0.2, 0]],
    ])
    const matcher = await buildTermMatcherLive('mushroom', vectors, embed)
    expect(matcher).not.toBeNull()
    expect(matcher!(recipe('m'))).toBe(true)
    expect(calls).toBe(1)
  })

  it('returns null for an empty term (no embed call)', async () => {
    let calls = 0
    const embed = async () => {
      calls++
      return [1, 0, 0]
    }
    const vectors = new Map<string, ReadonlyArray<number>>([['m', [1, 0, 0]]])
    expect(await buildTermMatcherLive('  ', vectors, embed)).toBeNull()
    expect(calls).toBe(0)
  })

  it('returns null when the vector index is empty (no embed call)', async () => {
    let calls = 0
    const embed = async () => {
      calls++
      return [1, 0, 0]
    }
    expect(await buildTermMatcherLive('rice', new Map(), embed)).toBeNull()
    expect(calls).toBe(0)
  })
})

describe('substringTermMatcher', () => {
  it('matches title and ingredient substrings', () => {
    const matches = substringTermMatcher('risotto')!
    const r: PlannerRecipe = {
      ...recipe('r1'),
      title: 'Groenterisotto',
      ingredients: [{ name: 'courgette' }],
    }
    expect(matches(r)).toBe(true)
    expect(matches(recipe('plain'))).toBe(false)
  })
})

describe('combineTermMatchers', () => {
  it('matches when any constituent matcher matches', () => {
    const a = (r: PlannerRecipe) => r.id === 'a'
    const b = (r: PlannerRecipe) => r.id === 'b'
    const combined = combineTermMatchers(a, b)!
    expect(combined(recipe('a'))).toBe(true)
    expect(combined(recipe('b'))).toBe(true)
    expect(combined(recipe('c'))).toBe(false)
  })
})
