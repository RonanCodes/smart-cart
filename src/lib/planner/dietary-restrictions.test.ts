import { describe, expect, it } from 'vitest'
import type { PlannerProfile, PlannerRecipe } from './types'
import { generateWeek, hardFilter } from './planner'

/**
 * Trust / safety property: a household's dietary restrictions are HARD limits, not
 * nudges. A vegetarian must never see a meat recipe, and a household that excludes
 * fish must never see a fish recipe — in the deterministic `hardFilter` AND in the
 * generated week the filter feeds.
 *
 * Two axes, matching how the app actually stores each restriction:
 *  - DIET field (`profile.diet = 'vegetarian'`): enforced via the recipe's
 *    `dietaryTags` (a meat recipe carries no 'vegetarian'/'vegan' tag, so it is
 *    dropped). This is the onboarding diet pick.
 *  - EXCLUSION / dislike field (`profile.dislikes = ['fish']`, the verbatim "Fish"
 *    avoid-chip lowercased by onboarding-mapping): enforced via an ingredient-name
 *    substring match, expanded through `expandExclusionSynonyms`.
 *
 * These run the REAL `hardFilter` / `generateWeek` over a fixed catalogue, so a
 * regression that lets meat or fish through fails the gate.
 */

/** A dinner row, defaults chosen so a clean recipe always survives the filter. */
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

describe('vegetarian diet excludes meat recipes (DIET field)', () => {
  /**
   * A catalogue that deliberately mixes clearly-MEAT dinners (no veg tag) with
   * vegetarian ones. The meat dinners carry meat ingredients AND no dietary tag,
   * which is exactly how an imported meat recipe looks. We assert the meat rows
   * are gone, not merely that survivors carry the tag, so the test locks the real
   * "no meat for a vegetarian" property.
   */
  function catalogueWithMeat(): Array<PlannerRecipe> {
    const meat: Array<[string, string, string]> = [
      ['beef-1', 'Spaghetti bolognese', 'beef mince'],
      ['chicken-1', 'Kip met rijst', 'chicken breast'],
      ['pork-1', 'Pork stir-fry', 'pork shoulder'],
      ['lamb-1', 'Lamskoteletten', 'lamb chops'],
    ]
    const out: Array<PlannerRecipe> = meat.map(([id, title, ing]) =>
      dinner(id, title, [ing, 'onion', 'garlic']),
    )
    // Enough vegetarian dinners to fill a 7-day week several times over, each
    // tagged the way the catalogue tags a real vegetarian recipe.
    for (let i = 0; i < 10; i++) {
      out.push(
        dinner(`veg-${i}`, `Veggie dish ${i}`, ['tofu', 'onion'], {
          dietaryTags: ['vegetarian'],
        }),
      )
    }
    // A vegan row counts as vegetarian-acceptable (a vegetarian may eat vegan).
    out.push(
      dinner('vegan-1', 'Vegan curry', ['chickpea', 'coconut milk'], {
        dietaryTags: ['vegan'],
      }),
    )
    return out
  }

  const MEAT_IDS = new Set(['beef-1', 'chicken-1', 'pork-1', 'lamb-1'])
  const profile: PlannerProfile = { diet: 'vegetarian' }

  it('hardFilter drops every meat recipe (no vegetarian tag)', () => {
    const filtered = hardFilter(catalogueWithMeat(), profile)
    expect(filtered.length).toBeGreaterThan(0)
    for (const r of filtered) {
      expect(MEAT_IDS.has(r.id)).toBe(false)
      // Every survivor positively carries a veg/vegan tag.
      const tags = r.dietaryTags.map((t) => t.toLowerCase())
      expect(tags.includes('vegetarian') || tags.includes('vegan')).toBe(true)
    }
  })

  it('a vegetarian household gets ZERO meat recipes in the generated week', () => {
    const recipes = catalogueWithMeat()
    const week = generateWeek(recipes, profile, [])
    expect(week.days).toHaveLength(7)
    const byId = new Map(recipes.map((r) => [r.id, r]))
    for (const d of week.days) {
      if (!d.recipeRef) continue
      expect(MEAT_IDS.has(d.recipeRef)).toBe(false)
      // The chosen recipe positively carries the vegetarian (or vegan) tag.
      const tags = byId
        .get(d.recipeRef)!
        .dietaryTags.map((t) => t.toLowerCase())
      expect(tags.includes('vegetarian') || tags.includes('vegan')).toBe(true)
    }
  })

  it('a meat recipe is dropped even when its dietaryTags are otherwise empty', () => {
    // The narrowest reproduction: one beef dinner, one veg dinner. The beef row
    // carries no tag at all (the default for an untagged import), so the diet
    // gate is the ONLY thing keeping it out.
    const recipes = [
      dinner('beef', 'Beef stew', ['beef chuck', 'carrot']),
      dinner('veg', 'Veg stew', ['lentil', 'carrot'], {
        dietaryTags: ['vegetarian'],
      }),
    ]
    const ids = hardFilter(recipes, profile).map((r) => r.id)
    expect(ids).toEqual(['veg'])
  })
})

describe('no-fish exclusion excludes fish recipes (dislike / exclusion field)', () => {
  /**
   * The "Fish" avoid-chip is stored by onboarding-mapping as the lowercased
   * dislike string 'fish'. The planner's hard filter expands each excluded term
   * via `expandExclusionSynonyms` and substring-matches it against ingredient
   * names. This is the exact profile shape a "no fish" household produces.
   */
  const profile: PlannerProfile = { dislikes: ['fish'] }

  it('drops a recipe whose ingredient name literally contains "fish"', () => {
    // The part that already works: an English-named fish ingredient is a
    // substring hit on 'fish', so it is excluded today.
    const recipes = [
      dinner('fish-en', 'White fish bake', ['white fish fillet', 'potato']),
      dinner('clean', 'Chicken & rice', ['chicken', 'rice']),
    ]
    const ids = hardFilter(recipes, profile).map((r) => r.id)
    expect(ids).not.toContain('fish-en')
    expect(ids).toContain('clean')
  })

  /**
   * GAP (Nic follow-up): in the Dutch-first catalogue, fish appears as 'zalm'
   * (salmon), 'tonijn' (tuna), 'kabeljauw' (cod), 'vis' (the generic NL word) —
   * none of which contains the substring "fish". `expandExclusionSynonyms('fish')`
   * returns only ['fish'] because dislike-synonyms.ts has NO generic fish/vis
   * group (it has salmon/zalm, tuna/tonijn, anchovy/ansjovis, shellfish, but the
   * "Fish" chip itself maps to nothing in NL). So a household that picked the
   * "Fish" avoid-chip still gets salmon/tuna/cod dinners.
   *
   * This is the REQUIRED behaviour, expressed as an EXPECTED-FAIL so it documents
   * the safety gap without breaking the gate for everyone. When the fish/vis group
   * (mapping 'fish' -> ['fish','vis','zalm','tonijn','kabeljauw',...]) is added,
   * this test will start PASSING and `it.fails` will then flag it so the marker is
   * removed. Hand to Nic (owns the diet/exclusion filter + dislike-synonyms groups).
   */
  function catalogueWithDutchFish(): Array<PlannerRecipe> {
    return [
      dinner('zalm', 'Zalm uit de oven', ['zalmfilet', 'rijst']),
      dinner('tonijn', 'Tonijnpasta', ['tonijn', 'pasta']),
      dinner('kabeljauw', 'Kabeljauw met aardappel', [
        'kabeljauw',
        'aardappel',
      ]),
      dinner('vis-generic', 'Vissticks met friet', ['vis', 'friet']),
      // Clean fallbacks so the week never starves.
      dinner('kip', 'Kip met rijst', ['kip', 'rijst']),
      dinner('veg', 'Groentecurry', ['tofu', 'kokosmelk']),
    ]
  }

  const DUTCH_FISH_IDS = new Set(['zalm', 'tonijn', 'kabeljauw', 'vis-generic'])

  it.fails(
    'GAP: a "no fish" household must not get Dutch-named fish (zalm/tonijn/kabeljauw/vis) — currently leaks',
    () => {
      const filtered = hardFilter(catalogueWithDutchFish(), profile)
      const survivingFish = filtered.filter((r) => DUTCH_FISH_IDS.has(r.id))
      // REQUIRED: zero Dutch-named fish dinners survive a "no fish" exclusion.
      expect(survivingFish).toEqual([])
    },
  )

  it.fails(
    'GAP: the generated week for a "no fish" household must contain ZERO fish dinners — currently leaks',
    () => {
      const recipes = catalogueWithDutchFish()
      const week = generateWeek(recipes, profile, [])
      for (const d of week.days) {
        if (!d.recipeRef) continue
        // REQUIRED: no Dutch-named fish dinner is ever placed in the week.
        expect(DUTCH_FISH_IDS.has(d.recipeRef)).toBe(false)
      }
    },
  )
})
