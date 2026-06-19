import { describe, expect, it } from 'vitest'
import type { RecipeLite, UserProfile } from './types'
import { trueScore, trueTopN } from './ground-truth'

/**
 * Guards the soft prep-time and calorie nudges added for the realistic synthetic
 * users (#38). The base cuisine/ingredient/vegetarian scoring is covered by
 * recsys.test.ts; here we pin the new feature dims and confirm they are no-ops
 * when the user expresses no preference (so plain profiles score exactly as before).
 */

function recipe(over: Partial<RecipeLite> = {}): RecipeLite {
  return {
    id: 'r',
    title: 't',
    cuisine: 'Italian',
    category: 'Main',
    dietaryTags: [],
    ingredients: [{ name: 'chicken' }],
    prepMinutes: 30,
    calories: 500,
    ...over,
  }
}

function user(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'u',
    lovedCuisines: [],
    dislikedCuisines: [],
    lovedIngredients: [],
    dislikedIngredients: [],
    vegetarian: false,
    ...over,
  }
}

describe('ground-truth prep + calorie nudges', () => {
  it('prep/calorie preferences are no-ops when the user expresses none', () => {
    const u = user()
    const fast = recipe({ prepMinutes: 10 })
    const slow = recipe({ prepMinutes: 120 })
    expect(trueScore(u, fast)).toBe(trueScore(u, slow))
  })

  it('a quick-cook user prefers fast recipes over slow ones', () => {
    const u = user({ maxPrepMinutes: 20 })
    const fast = recipe({ prepMinutes: 15 })
    const slow = recipe({ prepMinutes: 60 })
    expect(trueScore(u, fast)).toBeGreaterThan(trueScore(u, slow))
  })

  it('unknown prep time is left untouched', () => {
    const u = user({ maxPrepMinutes: 20 })
    const known = recipe({ prepMinutes: 60 })
    const unknown = recipe({ prepMinutes: null })
    expect(trueScore(u, unknown)).toBeGreaterThan(trueScore(u, known))
  })

  it('a lighter eater prefers low-calorie recipes; a hearty eater prefers rich ones', () => {
    const light = recipe({ calories: 350 })
    const heavy = recipe({ calories: 800 })
    const lighter = user({ caloriePreference: 'lighter' })
    const hearty = user({ caloriePreference: 'hearty' })
    expect(trueScore(lighter, light)).toBeGreaterThan(trueScore(lighter, heavy))
    expect(trueScore(hearty, heavy)).toBeGreaterThan(trueScore(hearty, light))
  })

  it('trueTopN respects the prep nudge for an otherwise-tied catalogue', () => {
    const cat: Array<RecipeLite> = [
      recipe({ id: 'fast', prepMinutes: 10, cuisine: 'Italian' }),
      recipe({ id: 'slow', prepMinutes: 90, cuisine: 'Italian' }),
    ]
    const u = user({ lovedCuisines: ['Italian'], maxPrepMinutes: 20 })
    expect(trueTopN(u, cat, 2)[0]).toBe('fast')
  })
})
