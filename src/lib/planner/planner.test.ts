import { describe, expect, it } from 'vitest'
import type { DayType, PlannerProfile, PlannerRecipe } from './types'
import { BUSY_PREP_CAP_MINUTES } from './types'
import { generateWeek, hardFilter, resolveDayTypes } from './planner'

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

  it('defaults every day to home when no cookDays (all 7 cooked)', () => {
    const week = generateWeek(recipes, {}, swipes)
    expect(week.days.map((d) => d.type)).toEqual(Array(7).fill('home'))
    for (const d of week.days) expect(d.recipeRef).toBeTruthy()
  })

  it('maps cookDays to the home/out rhythm (non-cook-days are out)', () => {
    // Cook Mon (0), Wed (2), Fri (4); the rest are out.
    const profile: PlannerProfile = { cookDays: [0, 2, 4] }
    const week = generateWeek(recipes, profile, swipes)
    expect(week.days.map((d) => d.type)).toEqual([
      'home',
      'out',
      'home',
      'out',
      'home',
      'out',
      'out',
    ])
    // Out days are cleared, home days carry a recipe.
    for (const d of week.days) {
      if (d.type === 'out') {
        expect(d.recipeRef).toBe('')
        expect(d.meal).toBe('')
      } else {
        expect(d.recipeRef).toBeTruthy()
      }
    }
  })

  it('out clears a day: no recipe, no pool consumption', () => {
    const override: Array<DayType> = [
      'out',
      'home',
      'home',
      'home',
      'home',
      'home',
      'home',
    ]
    const week = generateWeek(recipes, {}, swipes, { dayTypes: override })
    expect(week.days[0]!.type).toBe('out')
    expect(week.days[0]!.recipeRef).toBe('')
    // The six remaining home days are all filled with distinct recipes.
    const filled = week.days.filter((d) => d.recipeRef)
    expect(filled).toHaveLength(6)
    expect(new Set(filled.map((d) => d.recipeRef)).size).toBe(6)
  })

  it('busy caps prep at 25 minutes', () => {
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const override: Array<DayType> = Array(7).fill('busy')
    const week = generateWeek(recipes, {}, swipes, { dayTypes: override })
    expect(week.days).toHaveLength(7)
    for (const d of week.days) {
      const r = byId.get(d.recipeRef)!
      expect(r.prepMinutes).not.toBeNull()
      expect(r.prepMinutes!).toBeLessThanOrEqual(BUSY_PREP_CAP_MINUTES)
    }
  })

  it('busy falls back to the shortest available, never an empty cook-day', () => {
    // A catalogue where NOTHING is quick: every recipe is well over the cap.
    const slow: Array<PlannerRecipe> = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      title: `Slow dish ${i}`,
      cuisine: 'Italian',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: 'beef' }, { name: 'onion' }],
      calories: 600,
      protein: 30,
      // 40, 50, 60, ... all above the 25 cap; s0 is the shortest at 40.
      prepMinutes: 40 + i * 10,
    }))
    const week = generateWeek(slow, {}, [], {
      dayTypes: ['busy'] as Array<DayType>,
      days: 1,
    })
    expect(week.days).toHaveLength(1)
    const d = week.days[0]!
    expect(d.type).toBe('busy')
    // Never empty, and it picked the shortest available (s0 at 40 min).
    expect(d.recipeRef).toBe('s0')
  })

  it('home is unconstrained: long recipes are allowed', () => {
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const week = generateWeek(recipes, {}, swipes, {
      dayTypes: Array(7).fill('home') as Array<DayType>,
    })
    // At least one picked recipe is over the busy cap (proving home is unconstrained).
    const anyLong = week.days.some(
      (d) => (byId.get(d.recipeRef)!.prepMinutes ?? 0) > BUSY_PREP_CAP_MINUTES,
    )
    expect(anyLong).toBe(true)
  })

  it('keeps no-repeat and hard filters across mixed day types', () => {
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const profile: PlannerProfile = {
      diet: 'vegetarian',
      allergies: ['peanut'],
    }
    const override: Array<DayType> = [
      'home',
      'busy',
      'out',
      'busy',
      'home',
      'out',
      'busy',
    ]
    const week = generateWeek(recipes, profile, swipes, { dayTypes: override })
    const filled = week.days.filter((d) => d.recipeRef)
    // No repeats among filled days.
    expect(new Set(filled.map((d) => d.recipeRef)).size).toBe(filled.length)
    for (const d of filled) {
      const r = byId.get(d.recipeRef)!
      // Hard filters still hold: vegetarian, no peanut, dinner only.
      expect(r.dietaryTags.map((t) => t.toLowerCase())).toContain('vegetarian')
      const text = r.ingredients.map((i) => i.name.toLowerCase()).join(' ')
      expect(text.includes('peanut')).toBe(false)
      expect(r.mealType).toBe('dinner')
      // Busy days respect the cap.
      if (d.type === 'busy') {
        expect(r.prepMinutes!).toBeLessThanOrEqual(BUSY_PREP_CAP_MINUTES)
      }
    }
  })

  it('dayTypes override beats the cook-days rhythm', () => {
    // cookDays says only Monday is home, but the override forces all busy.
    const profile: PlannerProfile = { cookDays: [0] }
    const week = generateWeek(recipes, profile, swipes, {
      dayTypes: Array(7).fill('busy') as Array<DayType>,
    })
    expect(week.days.map((d) => d.type)).toEqual(Array(7).fill('busy'))
  })

  it('resolveDayTypes: short override falls back to the rhythm', () => {
    const profile: PlannerProfile = { cookDays: [0, 1] }
    // Override only covers the first day; the rest come from cookDays.
    const types = resolveDayTypes(7, profile, ['out'])
    expect(types).toEqual([
      'out', // from override
      'home', // cookDays has Tue (1)
      'out',
      'out',
      'out',
      'out',
      'out',
    ])
  })
})
