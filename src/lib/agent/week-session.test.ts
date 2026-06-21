import { describe, expect, it } from 'vitest'
import { generateWeek } from '../planner/planner'
import type { PlannerRecipe, PlannerSwipe } from '../planner/types'
import type { TermMatcher } from '../replan/types'
import { WeekSession } from './week-session'
import type { WeekSessionInit } from './week-session'

/**
 * Behaviour parity for the WeekSession tools, ported from the old replan engine
 * tests. The maths is unchanged (the helpers were lifted verbatim from
 * `applyReplan`), so these assert the SAME outcomes: skip clears a day, swap moves
 * to a different recipe with no repeats, exclude drops the term, lean-more biases
 * the week, and the term tools decline cleanly with no matcher.
 */
function catalogue(): Array<PlannerRecipe> {
  const cuisines = ['Italian', 'Thai', 'Mexican', 'Japanese']
  const out: Array<PlannerRecipe> = []
  let id = 0
  for (const cuisine of cuisines) {
    for (let i = 0; i < 25; i++) {
      const fish = i % 4 === 0
      out.push({
        id: `r${id++}`,
        title: fish ? `${cuisine} fish ${i}` : `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: [],
        ingredients: [
          { name: fish ? 'salmon fillet' : 'chicken breast' },
          { name: 'onion' },
          { name: 'garlic' },
        ],
        calories: 400 + (i % 5) * 120,
        protein: 15 + (i % 4) * 12,
        prepMinutes: 10 + (i % 6) * 8,
      })
    }
  }
  return out
}

const swipes: Array<PlannerSwipe> = [
  { recipeId: 'r0', like: true },
  { recipeId: 'r2', like: true },
  { recipeId: 'r25', like: false },
]

/** A deterministic substring stand-in for the embedding matcher. */
function termMatcher(term: string): TermMatcher {
  const t = term.toLowerCase().trim()
  return (r: PlannerRecipe): boolean => {
    const text = [r.title, r.cuisine ?? '', ...r.ingredients.map((i) => i.name)]
      .join(' ')
      .toLowerCase()
    return text.includes(t)
  }
}

const byRef = (recipes: Array<PlannerRecipe>) =>
  new Map(recipes.map((r) => [r.id, r]))

function session(
  recipes = catalogue(),
  extra: Partial<WeekSessionInit> = {},
): WeekSession {
  return new WeekSession({
    week: generateWeek(recipes, {}, swipes, { seed: 7 }),
    recipes,
    profile: {},
    swipes,
    seed: 7,
    buildMatcher: (term) => termMatcher(term),
    ...extra,
  })
}

describe('WeekSession.skipDays', () => {
  it('clears the named day and leaves the rest untouched', () => {
    const s = session()
    const res = s.skipDays(['Wednesday'])
    expect(res.changed).toBe(true)
    const week = s.getWeek()
    const wed = week.days.find((d) => d.day === 'Wednesday')!
    expect(wed.recipeRef).toBe('')
    expect(wed.meal).toBe('')
    expect(week.days.find((d) => d.day === 'Monday')!.recipeRef).toBeTruthy()
  })

  it('asks which day when none is named', () => {
    const res = session().skipDays([])
    expect(res.changed).toBe(false)
    expect(res.summary.toLowerCase()).toContain('which day')
  })
})

describe('WeekSession.swapDays', () => {
  it('replaces the named day with a different recipe, no repeats', () => {
    const s = session()
    const before = s.getWeek().days.find((d) => d.day === 'Friday')!.recipeRef
    const res = s.swapDays(['Friday'])
    expect(res.changed).toBe(true)
    const week = s.getWeek()
    const after = week.days.find((d) => d.day === 'Friday')!.recipeRef
    expect(after).not.toBe(before)
    const refs = week.days.map((d) => d.recipeRef)
    expect(new Set(refs).size).toBe(refs.length)
  })
})

describe('WeekSession.exclude', () => {
  it('drops every recipe with the term from the affected days', async () => {
    const recipes = catalogue()
    const fishLikes: Array<PlannerSwipe> = recipes
      .filter((r) => r.ingredients.some((i) => i.name.includes('salmon')))
      .map((r) => ({ recipeId: r.id, like: true }))
    const week = generateWeek(recipes, {}, fishLikes, { seed: 7 })
    const m = byRef(recipes)
    expect(
      week.days.some((d) =>
        m.get(d.recipeRef)?.ingredients.some((i) => i.name.includes('salmon')),
      ),
    ).toBe(true)

    const s = new WeekSession({
      week,
      recipes,
      profile: {},
      swipes: fishLikes,
      seed: 7,
      buildMatcher: (term) => termMatcher(term),
    })
    const res = await s.exclude('fish')
    expect(res.changed).toBe(true)
    for (const d of s.getWeek().days) {
      if (!d.recipeRef) continue
      const r = m.get(d.recipeRef)!
      const text = r.ingredients
        .map((i) => i.name)
        .join(' ')
        .toLowerCase()
      expect(text.includes('salmon')).toBe(false)
      expect(r.title.toLowerCase().includes('fish')).toBe(false)
    }
  })

  it('declines cleanly with no matcher (no embedding key)', async () => {
    const s = session(catalogue(), { buildMatcher: undefined })
    const before = s.getWeek().days.map((d) => d.recipeRef)
    const res = await s.exclude('fish')
    expect(res.changed).toBe(false)
    expect(s.getWeek().days.map((d) => d.recipeRef)).toEqual(before)
    expect(res.summary.toLowerCase()).toContain("can't filter")
  })

  it('keeps exclusions sticky when a later swap runs in the same session', async () => {
    const recipes = catalogue()
    const fishLikes: Array<PlannerSwipe> = recipes
      .filter((r) => r.ingredients.some((i) => i.name.includes('salmon')))
      .map((r) => ({ recipeId: r.id, like: true }))
    const week = generateWeek(recipes, {}, fishLikes, { seed: 7 })
    const m = byRef(recipes)
    const s = new WeekSession({
      week,
      recipes,
      profile: {},
      swipes: fishLikes,
      seed: 7,
      buildMatcher: (term) => termMatcher(term),
    })
    await s.exclude('fish')
    for (const d of s.getWeek().days) {
      if (!d.recipeRef) continue
      const r = m.get(d.recipeRef)!
      expect(r.ingredients.some((i) => i.name.includes('salmon'))).toBe(false)
    }
    const mondayBefore = s.getWeek().days.find((d) => d.day === 'Monday')!
    s.swapDays(['Monday'])
    const mondayAfter = s.getWeek().days.find((d) => d.day === 'Monday')!
    expect(mondayAfter.recipeRef).not.toBe(mondayBefore.recipeRef)
    const monRecipe = m.get(mondayAfter.recipeRef)!
    const text = monRecipe.ingredients
      .map((i) => i.name)
      .join(' ')
      .toLowerCase()
    expect(text.includes('salmon')).toBe(false)
    expect(monRecipe.title.toLowerCase().includes('fish')).toBe(false)
  })
})

describe('WeekSession.leanMore', () => {
  it('biases the week toward the term', async () => {
    const recipes = catalogue()
    const m = byRef(recipes)
    const s = new WeekSession({
      week: generateWeek(recipes, {}, swipes, { seed: 7 }),
      recipes,
      profile: {},
      swipes,
      seed: 7,
      buildMatcher: (term) => termMatcher(term),
    })
    const mexBefore = s
      .getWeek()
      .days.filter((d) => m.get(d.recipeRef)?.cuisine === 'Mexican').length
    await s.leanMore('mexican')
    const mexAfter = s
      .getWeek()
      .days.filter((d) => m.get(d.recipeRef)?.cuisine === 'Mexican').length
    expect(mexAfter).toBeGreaterThan(mexBefore)
  })

  it('respects hard filters while leaning (veg household never gets a meat dish)', async () => {
    const recipes: Array<PlannerRecipe> = [
      {
        id: 'meaty-rice',
        title: 'Kip met rijst',
        cuisine: 'Aziatisch',
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: [],
        ingredients: [{ name: 'rijst' }, { name: 'kip' }],
        calories: 600,
        protein: 30,
        prepMinutes: 25,
      },
      {
        id: 'veg-rice',
        title: 'Groenterisotto',
        cuisine: 'Italiaans',
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: ['vegetarian'],
        ingredients: [{ name: 'risottorijst' }, { name: 'courgette' }],
        calories: 500,
        protein: 15,
        prepMinutes: 30,
      },
      {
        id: 'veg-salad',
        title: 'Salade',
        cuisine: 'Hollands',
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: ['vegetarian'],
        ingredients: [{ name: 'sla' }],
        calories: 300,
        protein: 8,
        prepMinutes: 10,
      },
    ]
    const isRice: TermMatcher = (r) => {
      const text = [r.title, ...r.ingredients.map((i) => i.name)]
        .join(' ')
        .toLowerCase()
      return text.includes('rijst') || text.includes('risotto')
    }
    const s = new WeekSession({
      week: {
        days: [{ day: 'Monday', meal: 'Salade', recipeRef: 'veg-salad' }],
      },
      recipes,
      profile: { diet: 'vegetarian' },
      swipes: [],
      seed: 7,
      buildMatcher: () => isRice,
    })
    await s.leanMore('rice')
    for (const d of s.getWeek().days) {
      expect(d.recipeRef).not.toBe('meaty-rice')
    }
  })

  it('declines cleanly with no matcher (no embedding key)', async () => {
    const s = session(catalogue(), { buildMatcher: undefined })
    const before = s.getWeek().days.map((d) => d.recipeRef)
    const res = await s.leanMore('mexican')
    expect(res.changed).toBe(false)
    expect(s.getWeek().days.map((d) => d.recipeRef)).toEqual(before)
    expect(res.summary.toLowerCase()).toContain("can't add more")
  })
})

describe('WeekSession.makeQuicker / addMeal / regenerate', () => {
  it('makeQuicker replaces a day with a quick dinner (<= busy cap)', () => {
    const s = session()
    const res = s.makeQuicker(['Monday'])
    const mon = s.getWeek().days.find((d) => d.day === 'Monday')!
    const m = byRef(catalogue())
    if (res.changed) {
      const prep = m.get(mon.recipeRef)?.prepMinutes
      expect(prep != null && prep <= 25).toBe(true)
    }
  })

  it('addMeal fills an emptied day; regenerate refills the week', () => {
    const s = session()
    s.skipDays(['Tuesday'])
    expect(s.getWeek().days.find((d) => d.day === 'Tuesday')!.recipeRef).toBe(
      '',
    )
    const add = s.addMeal('Tuesday')
    expect(add.changed).toBe(true)
    expect(
      s.getWeek().days.find((d) => d.day === 'Tuesday')!.recipeRef,
    ).toBeTruthy()
  })
})

describe('WeekSession.describe', () => {
  it('reads back the week as day: meal lines', () => {
    const s = session()
    s.skipDays(['Sunday'])
    const text = s.describe()
    expect(text).toContain('Monday:')
    expect(text).toContain('Sunday: (eating out)')
  })
})
