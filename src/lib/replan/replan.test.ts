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

  /**
   * Regression for #177: "more rice" must genuinely lean a DUTCH catalogue ricey
   * (the real AH/Jumbo menu says "rijst", not "rice") AND the reply must reflect
   * the actual diff, never an optimistic "Leaned the week toward rice." when the
   * week did not move.
   *
   * The catalogue below mirrors the live one: a handful of Dutch rice dishes
   * ("... met rijst", risotto) buried under a pile of non-rice dishes, and the
   * onboarding swipes seed a non-rice-heavy starting week so the lean has work to
   * do. We match in the user's language ("rice"), which must reach the Dutch text.
   */
  function dutchCatalogue(withRice: boolean): Array<PlannerRecipe> {
    const out: Array<PlannerRecipe> = []
    let id = 0
    const nonRice = [
      { title: 'Vegan banh mi', ing: 'tofu' },
      { title: 'Pasta pesto', ing: 'spaghetti' },
      { title: 'Groentesoep', ing: 'wortel' },
      { title: 'Caprese salade', ing: 'mozzarella' },
    ]
    for (let i = 0; i < 16; i++) {
      const base = nonRice[i % nonRice.length]!
      out.push({
        id: `n${id++}`,
        title: `${base.title} ${i}`,
        cuisine: 'Hollands',
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: [],
        ingredients: [{ name: base.ing }, { name: 'ui' }],
        calories: 500,
        protein: 20,
        prepMinutes: 20,
      })
    }
    if (withRice) {
      for (let i = 0; i < 8; i++) {
        out.push({
          id: `rijst${id++}`,
          title:
            i % 2 === 0
              ? `Sticky kip met gewokte groenten en rijst ${i}`
              : `Risotto met pompoen ${i}`,
          cuisine: 'Aziatisch',
          category: 'Main',
          mealType: 'dinner',
          dietaryTags: [],
          ingredients:
            i % 2 === 0
              ? [{ name: 'rijst' }, { name: 'kip' }]
              : [{ name: 'risottorijst' }, { name: 'pompoen' }],
          calories: 600,
          protein: 25,
          prepMinutes: 30,
        })
      }
    }
    return out
  }

  const isRice = (r: PlannerRecipe | undefined) => {
    if (!r) return false
    const text = [r.title, ...r.ingredients.map((i) => i.name)]
      .join(' ')
      .toLowerCase()
    return text.includes('rijst') || text.includes('risotto')
  }

  it('"more rice" leans a Dutch catalogue ricey and reports the real diff (#177)', () => {
    const recipes = dutchCatalogue(true)
    const m = byRef(recipes)
    const noRiceSwipes: Array<PlannerSwipe> = recipes
      .filter((r) => !isRice(r))
      .slice(0, 6)
      .map((r) => ({ recipeId: r.id, like: true }))
    const c = {
      week: generateWeek(recipes, {}, noRiceSwipes, { seed: 7 }),
      recipes,
      profile: {},
      swipes: noRiceSwipes,
      seed: 7,
    }
    const riceBefore = c.week.days.filter((d) =>
      isRice(m.get(d.recipeRef)),
    ).length
    expect(riceBefore).toBe(0)

    const res = applyReplan(
      {
        type: 'more-of',
        days: [],
        term: 'rice',
        termKind: 'ingredient',
        reason: '',
      },
      c,
    )
    const riceAfter = res.week.days.filter((d) =>
      isRice(m.get(d.recipeRef)),
    ).length

    expect(riceAfter).toBeGreaterThan(riceBefore)
    expect(res.changed).toBe(true)
    expect(res.message.toLowerCase()).toContain('rice')
    expect(res.message.toLowerCase()).toMatch(/swapped \d+ dinner/)
    const refs = res.week.days.map((d) => d.recipeRef).filter(Boolean)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('"more rice" says so honestly when the menu has no rice dishes (#177)', () => {
    const recipes = dutchCatalogue(false)
    const c = {
      week: generateWeek(recipes, {}, [], { seed: 7 }),
      recipes,
      profile: {},
      swipes: [],
      seed: 7,
    }
    const before = c.week.days.map((d) => d.recipeRef)
    const res = applyReplan(
      {
        type: 'more-of',
        days: [],
        term: 'rice',
        termKind: 'ingredient',
        reason: '',
      },
      c,
    )
    expect(res.changed).toBe(false)
    expect(res.week.days.map((d) => d.recipeRef)).toEqual(before)
    expect(res.message.toLowerCase()).toContain("couldn't find")
    expect(res.message.toLowerCase()).toContain('rice')
  })

  it('respects hard filters while leaning (a veg household never gets a meat rice dish)', () => {
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
    const m = byRef(recipes)
    const c = {
      week: {
        days: [{ day: 'Monday', meal: 'Salade', recipeRef: 'veg-salad' }],
      },
      recipes,
      profile: { diet: 'vegetarian' },
      swipes: [] as Array<PlannerSwipe>,
      seed: 7,
    }
    const res = applyReplan(
      {
        type: 'more-of',
        days: [],
        term: 'rice',
        termKind: 'ingredient',
        reason: '',
      },
      c,
    )
    for (const d of res.week.days) {
      expect(d.recipeRef).not.toBe('meaty-rice')
    }
    const picked = res.week.days.map((d) => m.get(d.recipeRef)?.title)
    expect(picked).toContain('Groenterisotto')
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

describe('buildFallbackPrompt grounding', () => {
  it('is the bare instruction with no context (back-compat)', () => {
    const { prompt } = buildFallbackPrompt('do something')
    expect(prompt).toBe('Instruction: do something')
    expect(prompt).not.toContain('Household context')
  })

  it('folds in the hard filters and the catalogue cuisines', () => {
    const { prompt } = buildFallbackPrompt('lighter meals please', {
      profile: {
        diet: 'vegetarian',
        allergies: ['peanuts', 'shellfish'],
        cuisinesDisliked: ['thai'],
      },
      recipes: catalogue(),
    })
    expect(prompt).toContain('Household context')
    expect(prompt).toContain('Diet: vegetarian.')
    expect(prompt).toContain('peanuts, shellfish')
    expect(prompt).toContain('Dislikes: thai.')
    // Catalogue cuisines are derived, distinct, sorted, lowercased.
    expect(prompt).toContain('italian, japanese, mexican, thai')
    expect(prompt).toContain('Instruction: lighter meals please')
  })

  it('omits an empty section but keeps others', () => {
    const { prompt } = buildFallbackPrompt('x', {
      profile: { diet: 'pescatarian' },
    })
    expect(prompt).toContain('Diet: pescatarian.')
    expect(prompt).not.toContain('Allergies')
    expect(prompt).not.toContain('Cuisines available')
  })
})

describe('structured model response maps to a real week change', () => {
  /**
   * The full server-shaped path: an unrecognised instruction, no day named, the
   * model returns ONLY a constraint ('swap-day' + a day), and the engine turns
   * that into a single-meal swap grounded in the real catalogue. Proves the
   * structured-response -> week-change mapping the issue asked for, with the
   * model mocked (no network).
   */
  it('maps a mocked swap-day constraint into a single different meal', async () => {
    const recipes = catalogue()
    const phrase = "I'm bored of Friday, give me literally anything else"
    expect(parseIntent(phrase)).toBeNull()

    const c = ctx(recipes)
    const fridayBefore = c.week.days.find((d) => d.day === 'Friday')!.recipeRef

    const stub: GenerateObjectFn = async (args) => {
      // The prompt the engine built is grounded in the household + catalogue.
      expect(args.prompt).toContain('Household context')
      expect(args.prompt).toContain('Cuisines available')
      return {
        object: replanEditSchema.parse({
          type: 'swap-day',
          days: ['Friday'],
          term: null,
          termKind: null,
        }),
      }
    }

    const res = await replan(phrase, c, {
      model: stubModel,
      generateObject: stub,
    })
    expect(res.source).toBe('ai-fallback')
    expect(res.changed).toBe(true)

    const fridayAfter = res.week.days.find((d) => d.day === 'Friday')!.recipeRef
    expect(fridayAfter).not.toBe(fridayBefore)
    // Only Friday moved; every other day is untouched.
    for (const d of res.week.days) {
      if (d.day === 'Friday') continue
      const before = c.week.days.find((x) => x.day === d.day)!.recipeRef
      expect(d.recipeRef).toBe(before)
    }
    // No repeats introduced.
    const refs = res.week.days.map((d) => d.recipeRef).filter(Boolean)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it('an explicit promptContext on aiDeps is not overwritten by the engine', async () => {
    const c = ctx()
    let seenPrompt = ''
    const stub: GenerateObjectFn = async (args) => {
      seenPrompt = args.prompt
      return {
        object: replanEditSchema.parse({
          type: 'unknown',
          days: [],
          term: null,
          termKind: null,
        }),
      }
    }
    await replan('something the parser cannot read at all here', c, {
      model: stubModel,
      generateObject: stub,
      promptContext: { profile: { diet: 'keto' } },
    })
    expect(seenPrompt).toContain('Diet: keto.')
    // The caller-supplied context wins: catalogue cuisines are NOT injected.
    expect(seenPrompt).not.toContain('Cuisines available')
  })
})
