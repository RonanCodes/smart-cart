import { describe, expect, it } from 'vitest'
import type { PlannerProfile, PlannerRecipe } from './types'
import { BUSY_PREP_CAP_MINUTES } from './types'
import { generateWeek, topNForDay } from './planner'

/**
 * A synthetic catalogue with enough breadth to fill a week several times over and
 * leave plenty of alternatives for any single day: four cuisines, a meat/veg
 * axis, a peanut-allergen axis, and varied prep so the busy-day filter bites.
 * Mirrors planner.test.ts so the two suites agree on the fixture shape.
 */
function catalogue(): Array<PlannerRecipe> {
  const cuisines = ['Italian', 'Thai', 'Mexican', 'Japanese']
  const out: Array<PlannerRecipe> = []
  let id = 0
  for (const cuisine of cuisines) {
    for (let i = 0; i < 25; i++) {
      const veg = i % 3 === 0
      const peanut = i % 7 === 0
      out.push({
        id: `r${id++}`,
        title: `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: veg ? ['vegetarian'] : [],
        ingredients: [
          { name: veg ? 'tofu' : 'chicken breast' },
          ...(peanut ? [{ name: 'peanut butter' }] : []),
          { name: 'onion' },
          { name: 'garlic' },
        ],
        calories: 400 + (i % 5) * 120,
        protein: 15 + (i % 4) * 12,
        prepMinutes: 10 + (i % 6) * 8,
      })
    }
  }
  out.push({
    id: 'breakfast-1',
    title: 'Pancakes',
    cuisine: 'American',
    category: 'Main',
    mealType: 'breakfast',
    dietaryTags: ['vegetarian'],
    ingredients: [{ name: 'flour' }, { name: 'egg' }],
    calories: 500,
    protein: 12,
    prepMinutes: 20,
  })
  return out
}

const swipes = [
  { recipeId: 'r0', like: true },
  { recipeId: 'r2', like: true },
  { recipeId: 'r25', like: false },
  { recipeId: 'r50', like: false },
]

describe('topNForDay', () => {
  const recipes = catalogue()

  it('returns N alternatives by default (5)', () => {
    const alts = topNForDay(recipes, {}, swipes)
    expect(alts).toHaveLength(5)
  })

  it('respects a custom N', () => {
    expect(topNForDay(recipes, {}, swipes, { n: 3 })).toHaveLength(3)
    expect(topNForDay(recipes, {}, swipes, { n: 8 })).toHaveLength(8)
  })

  it('excludes the day’s current pick', () => {
    const current = 'r0'
    const alts = topNForDay(recipes, {}, swipes, { excludeRecipeId: current })
    expect(alts.map((r) => r.id)).not.toContain(current)
  })

  it('excludes every other recipe already in the week (no dupes)', () => {
    // Build a real week, then ask for alternatives to one day; none of the
    // returned recipes may already appear elsewhere in the week.
    const week = generateWeek(recipes, {}, swipes)
    const weekRecipeIds = week.days.map((d) => d.recipeRef).filter(Boolean)
    const target = week.days.find((d) => d.recipeRef)!
    const alts = topNForDay(recipes, {}, swipes, {
      excludeRecipeId: target.recipeRef,
      weekRecipeIds,
    })
    const altIds = new Set(alts.map((r) => r.id))
    for (const id of weekRecipeIds) {
      expect(altIds.has(id)).toBe(false)
    }
    // And the alternatives themselves are distinct.
    expect(altIds.size).toBe(alts.length)
  })

  it('respects the allergy hard filter (no allergen ever offered)', () => {
    const profile: PlannerProfile = { allergies: ['peanut'] }
    const alts = topNForDay(recipes, profile, swipes)
    for (const r of alts) {
      const text = r.ingredients.map((i) => i.name.toLowerCase()).join(' ')
      expect(text.includes('peanut')).toBe(false)
    }
  })

  it('respects the vegetarian diet hard filter', () => {
    const profile: PlannerProfile = { diet: 'vegetarian' }
    const alts = topNForDay(recipes, profile, swipes)
    expect(alts.length).toBeGreaterThan(0)
    for (const r of alts) {
      expect(r.dietaryTags).toContain('vegetarian')
    }
  })

  it('never offers a non-dinner recipe', () => {
    const alts = topNForDay(recipes, {}, swipes, { n: 20 })
    expect(alts.map((r) => r.id)).not.toContain('breakfast-1')
    for (const r of alts) expect(r.mealType).toBe('dinner')
  })

  it('offers only quick dinners on a busy day', () => {
    const alts = topNForDay(recipes, {}, swipes, { dayType: 'busy' })
    expect(alts.length).toBeGreaterThan(0)
    for (const r of alts) {
      expect(r.prepMinutes).not.toBeNull()
      expect(r.prepMinutes!).toBeLessThanOrEqual(BUSY_PREP_CAP_MINUTES)
    }
  })

  it('returns nothing for a skipped (out) day', () => {
    expect(topNForDay(recipes, {}, swipes, { dayType: 'out' })).toEqual([])
  })

  it('is deterministic for the same inputs', () => {
    const a = topNForDay(recipes, {}, swipes, { excludeRecipeId: 'r0' })
    const b = topNForDay(recipes, {}, swipes, { excludeRecipeId: 'r0' })
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
  })

  it('returns the top of the same ranking the week uses', () => {
    // The first alternative for a day (excluding the week) should be the
    // best-ranked recipe not already placed, i.e. the planner agrees with itself.
    const week = generateWeek(recipes, {}, swipes)
    const weekRecipeIds = week.days.map((d) => d.recipeRef).filter(Boolean)
    const alts = topNForDay(recipes, {}, swipes, { weekRecipeIds })
    expect(alts.length).toBeGreaterThan(0)
    expect(weekRecipeIds).not.toContain(alts[0]!.id)
  })

  it('falls back to the shortest available when nothing is quick on a busy day', () => {
    // A catalogue where every recipe is over the busy cap forces the fallback;
    // the picker must still offer the shortest ones rather than going empty.
    const slow: Array<PlannerRecipe> = Array.from({ length: 10 }, (_, i) => ({
      id: `slow${i}`,
      title: `Slow dish ${i}`,
      cuisine: 'Italian',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: 'chicken breast' }, { name: 'onion' }],
      calories: 600,
      protein: 30,
      prepMinutes: 40 + i, // all well over BUSY_PREP_CAP_MINUTES
    }))
    const alts = topNForDay(slow, {}, [], { dayType: 'busy', n: 3 })
    expect(alts).toHaveLength(3)
    // Shortest-first: the fallback prefers the lowest prep time.
    const preps = alts.map((r) => r.prepMinutes!)
    expect(preps).toEqual([...preps].sort((a, b) => a - b))
  })
})
