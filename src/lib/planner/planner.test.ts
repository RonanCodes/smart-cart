import { describe, expect, it } from 'vitest'
import type { DayType, PlannerProfile, PlannerRecipe } from './types'
import { BUSY_PREP_CAP_MINUTES } from './types'
import { generateWeek, hardFilter, resolveDayTypes, softScore } from './planner'

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

/**
 * Explicit cuisine like/hate (#122) replaces the swipe taste signal. It rides
 * the planner's soft nudge: a liked cuisine is lifted, a hated one pushed down,
 * everything else neutral. The load-bearing guarantee is that EMPTY lists leave
 * the score (and therefore the recsys regression fixture, which carries no
 * explicit cuisine prefs) completely unchanged.
 */
describe('cuisine bias (explicit like/hate, #122)', () => {
  /** One bare recipe of a given cuisine with no soft-scoring fields, so the only
   * non-zero softScore term can be the cuisine bias. */
  function recipeOf(cuisine: string): PlannerRecipe {
    return {
      id: `c-${cuisine}`,
      title: `${cuisine} dish`,
      cuisine,
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: 'onion' }],
      calories: null,
      protein: null,
      prepMinutes: null,
    }
  }

  it('empty cuisine lists leave softScore unchanged (regression-guard invariant)', () => {
    const r = recipeOf('Italian')
    // No cuisine prefs at all, and no other soft fields -> exactly 0.
    expect(softScore(r, {})).toBe(0)
    expect(softScore(r, { cuisinesLiked: [], cuisinesDisliked: [] })).toBe(0)
  })

  it('a liked cuisine scores above neutral, a hated one below', () => {
    const italian = recipeOf('Italian')
    const profile: PlannerProfile = {
      cuisinesLiked: ['italian'],
      cuisinesDisliked: ['thai'],
    }
    const liked = softScore(italian, profile)
    const neutral = softScore(recipeOf('Mexican'), profile)
    const hated = softScore(recipeOf('Thai'), profile)
    expect(liked).toBeGreaterThan(neutral)
    expect(neutral).toBeGreaterThan(hated)
    expect(neutral).toBe(0)
  })

  it('matches cuisine case-insensitively', () => {
    const r = recipeOf('ITALIAN')
    expect(softScore(r, { cuisinesLiked: ['italian'] })).toBeGreaterThan(0)
    expect(softScore(r, { cuisinesDisliked: ['italian'] })).toBeLessThan(0)
  })

  it('a liked cuisine ranks UP in the generated week', () => {
    // A flat catalogue: equal numbers across four cuisines, no swipe signal, no
    // soft fields, so without a cuisine pref the cuisines are interchangeable.
    const flat: Array<PlannerRecipe> = []
    let id = 0
    for (const cuisine of ['Italian', 'Thai', 'Mexican', 'Japanese']) {
      for (let i = 0; i < 5; i++) {
        flat.push({
          id: `f${id++}`,
          title: `${cuisine} ${i}`,
          cuisine,
          category: 'Main',
          mealType: 'dinner',
          dietaryTags: [],
          ingredients: [{ name: 'onion' }],
          calories: null,
          protein: null,
          prepMinutes: null,
        })
      }
    }
    const byId = new Map(flat.map((r) => [r.id, r]))

    const liked = generateWeek(flat, { cuisinesLiked: ['Italian'] }, [])
    const italianCount = liked.days.filter(
      (d) => byId.get(d.recipeRef)?.cuisine === 'Italian',
    ).length
    // Five Italian recipes exist; with the bias all five should land in the
    // 7-day week ahead of the neutral cuisines.
    expect(italianCount).toBe(5)
  })

  it('a hated cuisine never appears MORE than with no preference', () => {
    // The dislike rides the soft nudge, which only reorders recipes the
    // recommender already rated close together (the rank-position score is the
    // dominant axis, by design). So the guarantee at the week level is
    // directional: down-weighting a cuisine never increases how often it lands in
    // the week. The strict ordering (liked > neutral > hated) is asserted at the
    // softScore unit level above.
    const flat: Array<PlannerRecipe> = []
    let id = 0
    for (const cuisine of ['Italian', 'Thai', 'Mexican', 'Japanese']) {
      for (let i = 0; i < 5; i++) {
        flat.push({
          id: `h${id++}`,
          title: `${cuisine} ${i}`,
          cuisine,
          category: 'Main',
          mealType: 'dinner',
          dietaryTags: [],
          ingredients: [{ name: 'onion' }],
          calories: null,
          protein: null,
          prepMinutes: null,
        })
      }
    }
    const byId = new Map(flat.map((r) => [r.id, r]))
    const countThai = (week: ReturnType<typeof generateWeek>) =>
      week.days.filter((d) => byId.get(d.recipeRef)?.cuisine === 'Thai').length

    const baseline = countThai(generateWeek(flat, {}, []))
    const hated = countThai(
      generateWeek(flat, { cuisinesDisliked: ['Thai'] }, []),
    )
    expect(hated).toBeLessThanOrEqual(baseline)
  })
})

describe('generateWeek variety exclusion (#week-nav)', () => {
  const recipes = catalogue()

  it('an empty/absent excludeRecipeIds is a strict no-op', () => {
    const base = generateWeek(recipes, {}, swipes)
    const withEmpty = generateWeek(recipes, {}, swipes, {
      excludeRecipeIds: [],
    })
    expect(withEmpty.days).toEqual(base.days)
  })

  it('excluded recipes never reappear in the generated week', () => {
    const first = generateWeek(recipes, {}, swipes)
    const lastWeekIds = first.days.map((d) => d.recipeRef).filter(Boolean)
    const next = generateWeek(recipes, {}, swipes, {
      excludeRecipeIds: lastWeekIds,
    })
    const nextIds = next.days.map((d) => d.recipeRef).filter(Boolean)
    // None of last week's dinners appear in next week (variety).
    for (const id of nextIds) {
      expect(lastWeekIds).not.toContain(id)
    }
    // And the week still fills (the catalogue is large enough).
    expect(nextIds.length).toBe(7)
  })

  it('a small pool still fills next week instead of going all-empty (#320)', () => {
    // Pool smaller than a week (5 servable dinners), like a vegan/tight-allergy
    // household. Week 1 places all 5 (the two extra days are inherently "eating
    // out"). The bug: excluding week 1's dinners emptied the diet-filtered pool,
    // so EVERY next-week day came back empty. With a SOFT exclusion, next week
    // re-uses them and fills the same five days.
    const small: Array<PlannerRecipe> = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      title: `Dinner ${i}`,
      cuisine: 'Italian',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: 'pasta' }, { name: 'tomato' }],
      calories: 500,
      protein: 20,
      prepMinutes: 30,
    }))
    const first = generateWeek(small, {}, [])
    const firstIds = first.days.map((d) => d.recipeRef).filter(Boolean)
    expect(firstIds.length).toBe(5)
    const next = generateWeek(small, {}, [], { excludeRecipeIds: firstIds })
    const nextIds = next.days.map((d) => d.recipeRef).filter(Boolean)
    // Was 0 before the fix; must now match week 1's fill.
    expect(nextIds.length).toBe(firstIds.length)
  })
})

describe('generateWeek skip-day override (#week-nav)', () => {
  const recipes = catalogue()

  it('a sparse dayTypes override clears only the named day, rhythm fills the rest', () => {
    // Skip Friday (index 4), leave the rest as holes -> the profile rhythm
    // (every-day-home here) fills the other six.
    const override = [
      undefined,
      undefined,
      undefined,
      undefined,
      'out' as const,
      undefined,
      undefined,
    ]
    const week = generateWeek(recipes, {}, swipes, { dayTypes: override })
    const friday = week.days[4]!
    expect(friday.type).toBe('out')
    expect(friday.recipeRef).toBe('')
    // The other six days are real dinners.
    const cooked = week.days.filter((d) => d.recipeRef)
    expect(cooked).toHaveLength(6)
  })
})
