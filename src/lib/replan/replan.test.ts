import { describe, expect, it } from 'vitest'
import { generateWeek } from '../planner/planner'
import type { LanguageModel } from 'ai'
import type { PlannerRecipe, PlannerSwipe } from '../planner/types'
import { parseIntent } from './parse'
import { applyReplan } from './apply'
import { replan } from './replan'
import {
  buildFallbackPrompt,
  replanEditSchema,
  runAiFallback,
  toReplanEdit,
} from './fallback'
import type { GenerateObjectFn } from './fallback'
import type { ReplanContext } from './types'

/**
 * A synthetic catalogue broad enough to fill several weeks, with a fish axis and
 * a Mexican-cuisine axis so the exclude / more-of intents have something to bite.
 * Mirrors the planner's own fixture style.
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

function ctx(recipes = catalogue()): ReplanContext {
  return {
    week: generateWeek(recipes, {}, swipes, { seed: 7 }),
    recipes,
    profile: {},
    swipes,
    seed: 7,
  }
}

const byRef = (recipes: Array<PlannerRecipe>) =>
  new Map(recipes.map((r) => [r.id, r]))

/** A throwaway model handle; the stubbed generateObject never inspects it. */
const stubModel = {} as unknown as LanguageModel

describe('parseIntent', () => {
  it('reads "eating out Wednesday" as skip-day', () => {
    const e = parseIntent('eating out Wednesday')
    expect(e?.type).toBe('skip-day')
    expect(e?.days).toEqual(['Wednesday'])
  })

  it('reads "swap Friday" and "not this one" as swap-day', () => {
    expect(parseIntent('swap Friday')?.type).toBe('swap-day')
    expect(parseIntent('swap Friday')?.days).toEqual(['Friday'])
    const notThis = parseIntent('not this one')
    expect(notThis?.type).toBe('swap-day')
    expect(notThis?.days).toEqual([])
  })

  it('reads "no fish" and "no Mexican this week" as exclude', () => {
    const fish = parseIntent('no fish')
    expect(fish?.type).toBe('exclude')
    expect(fish?.term).toBe('fish')
    expect(fish?.termKind).toBe('ingredient')
    const mex = parseIntent('no Mexican this week')
    expect(mex?.type).toBe('exclude')
    expect(mex?.term).toBe('mexican')
    expect(mex?.termKind).toBe('cuisine')
  })

  it('reads "more pasta" as more-of with a cuisine term', () => {
    const e = parseIntent('more pasta')
    expect(e?.type).toBe('more-of')
    expect(e?.term).toBe('pasta')
    expect(e?.termKind).toBe('cuisine')
  })

  it('reads "make it cheaper" as needs-pricing (recognised, blocked)', () => {
    expect(parseIntent('make it cheaper')?.type).toBe('needs-pricing')
  })

  it('returns null for a phrase it cannot read', () => {
    expect(
      parseIntent('surprise me with something fancy for the in-laws'),
    ).toBeNull()
  })
})

describe('applyReplan — deterministic intents visibly replan', () => {
  it('skip-day clears the named day', () => {
    const c = ctx()
    const res = applyReplan(parseIntent('eating out Wednesday')!, c)
    expect(res.changed).toBe(true)
    const wed = res.week.days.find((d) => d.day === 'Wednesday')!
    expect(wed.recipeRef).toBe('')
    expect(wed.meal).toBe('')
    // Other days untouched.
    const mon = res.week.days.find((d) => d.day === 'Monday')!
    expect(mon.recipeRef).toBeTruthy()
  })

  it('swap-day replaces the named day with a different recipe', () => {
    const c = ctx()
    const before = c.week.days.find((d) => d.day === 'Friday')!.recipeRef
    const res = applyReplan(parseIntent('swap Friday')!, c)
    expect(res.changed).toBe(true)
    const after = res.week.days.find((d) => d.day === 'Friday')!.recipeRef
    expect(after).not.toBe(before)
    // No repeats introduced.
    const refs = res.week.days.map((d) => d.recipeRef)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('exclude drops every recipe with the term from affected days', () => {
    const recipes = catalogue()
    // Force a fish-heavy starting week so exclude has work to do.
    const fishLikes: Array<PlannerSwipe> = recipes
      .filter((r) => r.ingredients.some((i) => i.name.includes('salmon')))
      .map((r) => ({ recipeId: r.id, like: true }))
    const week = generateWeek(recipes, {}, fishLikes, { seed: 7 })
    const m = byRef(recipes)
    const hadFish = week.days.some((d) =>
      m.get(d.recipeRef)?.ingredients.some((i) => i.name.includes('salmon')),
    )
    expect(hadFish).toBe(true)

    const res = applyReplan(parseIntent('no fish')!, {
      week,
      recipes,
      profile: {},
      swipes: fishLikes,
      seed: 7,
    })
    expect(res.changed).toBe(true)
    for (const d of res.week.days) {
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

  it('more-of biases the week toward the term', () => {
    const recipes = catalogue()
    const m = byRef(recipes)
    const c = {
      week: generateWeek(recipes, {}, swipes, { seed: 7 }),
      recipes,
      profile: {},
      swipes,
      seed: 7,
    }
    const mexBefore = c.week.days.filter(
      (d) => m.get(d.recipeRef)?.cuisine === 'Mexican',
    ).length
    const res = applyReplan(
      {
        type: 'more-of',
        days: [],
        term: 'mexican',
        termKind: 'cuisine',
        reason: '',
      },
      c,
    )
    const mexAfter = res.week.days.filter(
      (d) => m.get(d.recipeRef)?.cuisine === 'Mexican',
    ).length
    expect(mexAfter).toBeGreaterThan(mexBefore)
  })

  it('needs-pricing returns a clear blocked message, week unchanged', () => {
    const c = ctx()
    const res = applyReplan(parseIntent('make it cheaper')!, c)
    expect(res.changed).toBe(false)
    expect(res.week.days).toEqual(c.week.days)
    expect(res.message.toLowerCase()).toContain('price')
  })
})

describe('AI fallback (mocked, no network)', () => {
  it('declines cleanly with no model (offline-shippable path)', async () => {
    const edit = await runAiFallback('do something clever', {})
    expect(edit.type).toBe('unknown')
  })

  it('builds a prompt and maps a mocked structured edit', async () => {
    const { system, prompt } = buildFallbackPrompt(
      'lay off the seafood this week',
    )
    expect(system).toContain('NEVER')
    expect(prompt).toContain('seafood')

    // Stub generateObject: the "LLM" returns a constraint only, never a recipe.
    const stub: GenerateObjectFn = async () => ({
      object: replanEditSchema.parse({
        type: 'exclude',
        days: [],
        term: 'seafood',
        termKind: 'ingredient',
      }),
    })
    const edit = await runAiFallback('lay off the seafood this week', {
      model: stubModel,
      generateObject: stub,
    })
    expect(edit.type).toBe('exclude')
    expect(edit.term).toBe('seafood')
  })

  it('end-to-end: an unrecognised phrase routes through the mocked fallback and replans', async () => {
    const recipes = catalogue()
    const m = byRef(recipes)
    // A phrase the deterministic parser returns null for.
    const phrase = 'please lean the menu towards the spicy stuff'
    expect(parseIntent(phrase)).toBeNull()

    const stub: GenerateObjectFn = async () => ({
      object: replanEditSchema.parse({
        type: 'more-of',
        days: [],
        term: 'mexican',
        termKind: 'cuisine',
      }),
    })
    const c = ctx(recipes)
    const mexBefore = c.week.days.filter(
      (d) => m.get(d.recipeRef)?.cuisine === 'Mexican',
    ).length
    const res = await replan(phrase, c, {
      model: stubModel,
      generateObject: stub,
    })
    expect(res.source).toBe('ai-fallback')
    const mexAfter = res.week.days.filter(
      (d) => m.get(d.recipeRef)?.cuisine === 'Mexican',
    ).length
    expect(mexAfter).toBeGreaterThan(mexBefore)
  })

  it('degrades to a clear "unknown" message when the fallback declines', async () => {
    const c = ctx()
    const res = await replan('???', c, {}) // no model
    expect(res.source).toBe('ai-fallback')
    expect(res.changed).toBe(false)
    expect(res.message.toLowerCase()).toContain("couldn't")
  })

  it('toReplanEdit synthesizes a reason locally', () => {
    const e = toReplanEdit({
      type: 'skip-day',
      days: ['Tuesday'],
      term: null,
      termKind: null,
    })
    expect(e.reason).toContain('Tuesday')
  })
})

describe('replan orchestrator prefers the deterministic path', () => {
  it('uses the deterministic parser for a known phrase (no model needed)', async () => {
    const c = ctx()
    const res = await replan('eating out Wednesday', c)
    expect(res.source).toBe('deterministic')
    expect(res.changed).toBe(true)
  })
})
