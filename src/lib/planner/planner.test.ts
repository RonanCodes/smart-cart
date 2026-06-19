import { describe, expect, it } from 'vitest'
import type { PlannerProfile, PlannerRecipe } from './types'
import { generateWeek, hardFilter } from './planner'

/**
 * A synthetic catalogue with enough breadth to fill a week several times over:
 * four cuisines, a meat/veg axis, a peanut-allergen axis, and varied
 * calorie/protein/prep so the soft nudges have something to bite on.
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
  // A couple of non-dinner rows that must never be picked.
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
  { recipeId: 'r0', like: true }, // Italian, veg
  { recipeId: 'r2', like: true }, // Italian
  { recipeId: 'r25', like: false }, // Thai
  { recipeId: 'r50', like: false }, // Mexican
]

describe('planner', () => {
  const recipes = catalogue()

  it('produces seven real recipes, one per day', () => {
    const week = generateWeek(recipes, {}, swipes)
    expect(week.days).toHaveLength(7)
    const ids = new Set(recipes.map((r) => r.id))
    for (const d of week.days) {
      expect(ids.has(d.recipeRef)).toBe(true)
      expect(d.meal).toBeTruthy()
    }
    const labels = week.days.map((d) => d.day)
    expect(labels).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
  })

  it('never repeats a recipe within the week', () => {
    const week = generateWeek(recipes, {}, swipes)
    const refs = week.days.map((d) => d.recipeRef)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('respects the allergy hard filter (no allergen ever appears)', () => {
    const profile: PlannerProfile = { allergies: ['peanut'] }
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const week = generateWeek(recipes, profile, swipes)
    expect(week.days).toHaveLength(7)
    for (const d of week.days) {
      const r = byId.get(d.recipeRef)!
      const text = r.ingredients.map((i) => i.name.toLowerCase()).join(' ')
      expect(text.includes('peanut')).toBe(false)
    }
  })

  it('respects the vegetarian diet hard filter', () => {
    const profile: PlannerProfile = { diet: 'vegetarian' }
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const week = generateWeek(recipes, profile, swipes)
    expect(week.days).toHaveLength(7)
    for (const d of week.days) {
      const r = byId.get(d.recipeRef)!
      expect(r.dietaryTags.map((t) => t.toLowerCase())).toContain('vegetarian')
    }
  })

  it('only plans dinners, never breakfast/lunch/snack', () => {
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const week = generateWeek(recipes, {}, swipes)
    for (const d of week.days) {
      expect(byId.get(d.recipeRef)!.mealType).toBe('dinner')
    }
  })

  it('is deterministic given a fixed profile, swipes and seed', () => {
    const a = generateWeek(recipes, { caloriesPerDay: 2000 }, swipes)
    const b = generateWeek(recipes, { caloriesPerDay: 2000 }, swipes)
    expect(a.days.map((d) => d.recipeRef)).toEqual(
      b.days.map((d) => d.recipeRef),
    )
  })

  it('hardFilter drops allergen, off-diet and non-dinner recipes', () => {
    const filtered = hardFilter(recipes, {
      allergies: ['peanut'],
      diet: 'vegetarian',
    })
    expect(filtered.length).toBeGreaterThan(0)
    for (const r of filtered) {
      expect(r.mealType).toBe('dinner')
      expect(r.dietaryTags).toContain('vegetarian')
      const text = r.ingredients.map((i) => i.name.toLowerCase()).join(' ')
      expect(text.includes('peanut')).toBe(false)
    }
  })

  it('always fills the week even with a narrow profile', () => {
    const week = generateWeek(
      recipes,
      { diet: 'vegetarian', allergies: ['peanut'], caloriesPerDay: 1800 },
      swipes,
    )
    expect(week.days).toHaveLength(7)
    expect(new Set(week.days.map((d) => d.recipeRef)).size).toBe(7)
  })
})
