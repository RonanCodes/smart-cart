import { describe, expect, it } from 'vitest'
import type { PlannerProfile, PlannerRecipe } from './types'
import { generateWeek, hardFilter } from './planner'

/**
 * Regression tests for two planner bugs:
 *  - #452: an excluded ingredient given in English ("mushroom") must still catch
 *    the Dutch-first catalogue's term ("champignon" / "paddenstoel").
 *  - #453: a variety-preferring household must not get two of the same DISH (two
 *    lasagnas) in one week, even when they are distinct recipe rows.
 */

function dinner(
  id: string,
  title: string,
  ingredients: Array<string>,
  extra: Partial<PlannerRecipe> = {},
): PlannerRecipe {
  return {
    id,
    title,
    cuisine: extra.cuisine ?? 'Dutch',
    category: 'Main',
    mealType: 'dinner',
    dietaryTags: extra.dietaryTags ?? [],
    ingredients: ingredients.map((name) => ({ name })),
    calories: extra.calories ?? 500,
    protein: extra.protein ?? 20,
    prepMinutes: extra.prepMinutes ?? 30,
    ...extra,
  }
}

describe('#452 excluded ingredient is matched cross-language (EN <-> NL)', () => {
  it('a household excluding "mushroom" never gets a Dutch champignon recipe', () => {
    const recipes: Array<PlannerRecipe> = [
      dinner('champignon-1', 'Champignonrisotto', ['champignon', 'rijst']),
      dinner('paddenstoel-1', 'Paddenstoelenpasta', ['paddenstoel', 'pasta']),
      // A clean recipe so the week always has something to fall back to.
      dinner('clean-1', 'Tomatensoep', ['tomaat', 'ui']),
      dinner('clean-2', 'Kip met rijst', ['kip', 'rijst']),
    ]
    const profile: PlannerProfile = { dislikes: ['mushroom'] }

    const filtered = hardFilter(recipes, profile)
    const ids = filtered.map((r) => r.id)
    expect(ids).not.toContain('champignon-1')
    expect(ids).not.toContain('paddenstoel-1')

    const week = generateWeek(recipes, profile, [])
    const byId = new Map(recipes.map((r) => [r.id, r]))
    for (const d of week.days) {
      if (!d.recipeRef) continue
      const text = byId
        .get(d.recipeRef)!
        .ingredients.map((i) => i.name.toLowerCase())
        .join(' ')
      expect(text.includes('champignon')).toBe(false)
      expect(text.includes('paddenstoel')).toBe(false)
    }
  })

  it('excluding the Dutch "champignon" also drops the English "mushroom" recipe', () => {
    const recipes: Array<PlannerRecipe> = [
      dinner('mushroom-1', 'Mushroom risotto', ['mushroom', 'rice']),
      dinner('clean-1', 'Tomato soup', ['tomato', 'onion']),
    ]
    const filtered = hardFilter(recipes, { dislikes: ['champignon'] })
    expect(filtered.map((r) => r.id)).not.toContain('mushroom-1')
  })
})

describe('#453 variety preference blocks near-duplicate dishes', () => {
  /** A flat catalogue: two distinct lasagna rows plus enough DISTINCT dishes so a
   * varied week is genuinely possible (different dish bases each). */
  function withTwoLasagnas(): Array<PlannerRecipe> {
    const out: Array<PlannerRecipe> = [
      dinner('lasagna-1', 'Lasagne Bolognese', ['pasta', 'gehakt'], {
        cuisine: 'Italian',
      }),
      dinner('lasagna-2', 'Vegetarische lasagne', ['pasta', 'spinazie'], {
        cuisine: 'Italian',
        dietaryTags: ['vegetarian'],
      }),
    ]
    // Eight clearly-different dishes (distinct dish bases) so a varied 7-day week
    // never needs to fall back to the second lasagna.
    const others: Array<[string, string]> = [
      ['curry-1', 'Kip kerrie'],
      ['risotto-1', 'Paddenstoelrisotto'],
      ['stamppot-1', 'Stamppot boerenkool'],
      ['soup-1', 'Tomatensoep'],
      ['burger-1', 'Hamburger met friet'],
      ['taco-1', "Taco's met kip"],
      ['paella-1', 'Paella'],
      ['ramen-1', 'Ramen'],
    ]
    for (const [id, title] of others) {
      out.push(dinner(id, title, ['ui', 'rijst'], { cuisine: 'Dutch' }))
    }
    return out
  }

  const VARIETY_GOAL = 'Cook and discover new recipes'

  const countLasagna = (week: ReturnType<typeof generateWeek>) =>
    week.days.filter((d) => d.meal.toLowerCase().includes('lasagne')).length

  it('a variety-preferring household does not get two lasagnas in one week', () => {
    const recipes = withTwoLasagnas()
    const profile: PlannerProfile = { goals: [VARIETY_GOAL] }
    const week = generateWeek(recipes, profile, [])
    expect(countLasagna(week)).toBeLessThanOrEqual(1)
    // The week still fills its days (variety is honoured WITHOUT emptying it).
    expect(week.days.filter((d) => d.recipeRef).length).toBe(7)
  })

  it('WITHOUT the variety goal the planner still allows two lasagnas (control)', () => {
    // Proves the fix is gated on the preference: a household that did NOT ask for
    // variety keeps the prior exact-recipe-only de-dup, so a small catalogue can
    // still surface both lasagnas. This is the behaviour #453 changes only when
    // variety is signalled.
    const recipes = withTwoLasagnas()
    const week = generateWeek(recipes, {}, [])
    expect(countLasagna(week)).toBe(2)
  })

  it('detects the variety goal from the real onboarding label substring', () => {
    const recipes = withTwoLasagnas()
    // The exact label the goals step writes (#453 onboarding copy).
    const profile: PlannerProfile = { goals: ['Cook and discover new recipes'] }
    expect(
      countLasagna(generateWeek(recipes, profile, [])),
    ).toBeLessThanOrEqual(1)
  })
})
