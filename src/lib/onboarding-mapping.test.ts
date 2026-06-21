import { describe, it, expect } from 'vitest'
import { draftToHousehold } from './onboarding-mapping'
import { deriveBadges } from './badges'
import { hardFilter } from './planner/planner'
import { EMPTY_DRAFT } from '#/components/onboarding/form-state'
import type { OnboardingDraft } from '#/components/onboarding/form-state'
import type { PlannerRecipe } from './planner/types'

/**
 * Two layers under test:
 *  1. draftToHousehold — the pure draft -> household/profile mapping.
 *  2. The glue: feeding that mapped profile into the planner's hardFilter and
 *     asserting diet + dislikes actually act as HARD filters. This is the
 *     load-bearing contract of #110 (the form is now the data source), proven
 *     pure-to-pure with no DB.
 */

function draft(over: Partial<OnboardingDraft>): OnboardingDraft {
  return { ...EMPTY_DRAFT, ...over }
}

function recipe(over: Partial<PlannerRecipe> & { id: string }): PlannerRecipe {
  return {
    id: over.id,
    title: over.title ?? over.id,
    cuisine: over.cuisine ?? null,
    category: over.category ?? null,
    dietaryTags: over.dietaryTags ?? [],
    ingredients: over.ingredients ?? [],
    calories: over.calories ?? null,
    protein: over.protein ?? null,
    prepMinutes: over.prepMinutes ?? null,
    mealType: over.mealType ?? 'dinner',
  }
}

describe('draftToHousehold mapping', () => {
  it('maps household size onto the dedicated columns, clamped', () => {
    const m = draftToHousehold(draft({ adults: 3, children: 2 }))
    expect(m.adults).toBe(3)
    expect(m.children).toBe(2)
  })

  it('floors adults at 1 and children at 0', () => {
    const m = draftToHousehold(draft({ adults: 0, children: -4 }))
    expect(m.adults).toBe(1)
    expect(m.children).toBe(0)
  })

  it('sets preferredStore for each selectable store (ah/jumbo/picnic)', () => {
    expect(draftToHousehold(draft({ store: 'ah' })).preferredStore).toBe('ah')
    expect(draftToHousehold(draft({ store: 'jumbo' })).preferredStore).toBe(
      'jumbo',
    )
    expect(draftToHousehold(draft({ store: 'picnic' })).preferredStore).toBe(
      'picnic',
    )
  })

  it('leaves preferredStore undefined for a null or unknown store', () => {
    expect(
      draftToHousehold(draft({ store: null })).preferredStore,
    ).toBeUndefined()
    // an unknown slug is never persisted
    expect(
      draftToHousehold(draft({ store: 'lidl' })).preferredStore,
    ).toBeUndefined()
  })

  it("defaults preferredLocale to 'en' and carries 'nl' when picked (#310)", () => {
    expect(draftToHousehold(EMPTY_DRAFT).preferredLocale).toBe('en')
    expect(draftToHousehold(draft({ locale: 'nl' })).preferredLocale).toBe('nl')
    expect(draftToHousehold(draft({ locale: 'en' })).preferredLocale).toBe('en')
  })

  it('maps cuisine likes/hates onto the profile (normalised, deduped)', () => {
    const m = draftToHousehold(
      draft({
        cuisinesLiked: ['Italian', 'italian', 'Thai'],
        cuisinesDisliked: ['Mexican'],
      }),
    )
    expect(m.profile.cuisinesLiked).toEqual(['italian', 'thai'])
    expect(m.profile.cuisinesDisliked).toEqual(['mexican'])
  })

  it('never keeps a cuisine in both like and hate (like wins)', () => {
    const m = draftToHousehold(
      draft({ cuisinesLiked: ['Thai'], cuisinesDisliked: ['Thai', 'Indian'] }),
    )
    expect(m.profile.cuisinesLiked).toContain('thai')
    expect(m.profile.cuisinesDisliked).not.toContain('thai')
    expect(m.profile.cuisinesDisliked).toEqual(['indian'])
  })

  it('empty cuisine selections map to empty lists', () => {
    const m = draftToHousehold(EMPTY_DRAFT)
    expect(m.profile.cuisinesLiked).toEqual([])
    expect(m.profile.cuisinesDisliked).toEqual([])
  })

  it('carries pets, childrenAges, equipment and goals onto the profile', () => {
    const m = draftToHousehold(
      draft({
        pets: { cats: 1, dogs: 2 },
        childrenAges: [4, 7],
        equipment: ['Oven', 'Air fryer'],
        goals: ['Eat balanced', 'Pay less'],
      }),
    )
    expect(m.profile.pets).toEqual({ cats: 1, dogs: 2 })
    expect(m.profile.childrenAges).toEqual([4, 7])
    expect(m.profile.equipment).toEqual(['Oven', 'Air fryer'])
    expect(m.profile.goals).toEqual(['Eat balanced', 'Pay less'])
  })

  it('collapses the diet multi-select to the strictest tag-diet (vegan wins)', () => {
    expect(draftToHousehold(draft({ diet: ['Vegetarian'] })).profile.diet).toBe(
      'vegetarian',
    )
    expect(
      draftToHousehold(draft({ diet: ['Vegetarian', 'Vegan'] })).profile.diet,
    ).toBe('vegan')
  })

  it('turns dislikes + exclusion-only diets into lowercased allergy substrings', () => {
    const m = draftToHousehold(
      draft({ dislikes: ['Anchovies'], diet: ['Dairy free', 'Porkless'] }),
    )
    expect(m.profile.dislikes).toEqual(['anchovies'])
    // dislike + the dairy/pork exclusion substrings, deduped
    expect(m.profile.allergies).toContain('anchovies')
    expect(m.profile.allergies).toContain('milk')
    expect(m.profile.allergies).toContain('pork')
    // no tag-diet picked -> no veg gate
    expect(m.profile.diet).toBeUndefined()
  })
})

describe('mapping -> planner hardFilter glue', () => {
  const beefStew = recipe({
    id: 'beef',
    title: 'Beef stew',
    ingredients: [{ name: 'Beef' }, { name: 'Onion' }],
  })
  const veganCurry = recipe({
    id: 'curry',
    title: 'Chickpea curry',
    dietaryTags: ['vegan'],
    ingredients: [{ name: 'Chickpeas' }, { name: 'Coconut milk' }],
  })
  const anchovyPizza = recipe({
    id: 'pizza',
    title: 'Anchovy pizza',
    ingredients: [{ name: 'Anchovies' }, { name: 'Cheese' }],
  })

  it('a dislike removes any recipe containing that ingredient (hard)', () => {
    const { profile } = draftToHousehold(draft({ dislikes: ['Anchovies'] }))
    const kept = hardFilter([beefStew, veganCurry, anchovyPizza], profile)
    expect(kept.map((r) => r.id)).not.toContain('pizza')
    expect(kept.map((r) => r.id)).toEqual(
      expect.arrayContaining(['beef', 'curry']),
    )
  })

  it('a vegan diet keeps only vegan-tagged recipes (hard)', () => {
    const { profile } = draftToHousehold(draft({ diet: ['Vegan'] }))
    const kept = hardFilter([beefStew, veganCurry, anchovyPizza], profile)
    expect(kept.map((r) => r.id)).toEqual(['curry'])
  })

  it('an empty draft filters nothing out (all dinners are candidates)', () => {
    const { profile } = draftToHousehold(EMPTY_DRAFT)
    const kept = hardFilter([beefStew, veganCurry, anchovyPizza], profile)
    expect(kept).toHaveLength(3)
  })
})

describe('mapping -> deriveBadges glue (#208)', () => {
  it('a fresh form onboarding yields cuisine + diet + goal badges', () => {
    const { profile } = draftToHousehold(
      draft({
        cuisinesLiked: ['Italian', 'Thai'],
        diet: ['Vegetarian'],
        goals: ['Pay less for my groceries'],
      }),
    )
    // The mapped profile is exactly what getHouseholdSummary passes through.
    const labels = deriveBadges(profile).map((b) => b.label)
    expect(labels).toContain('Pasta person') // Italian, despite lowercasing
    expect(labels).toContain('Thai spice seeker')
    expect(labels).toContain('Veggie-first') // vegetarian diet
    expect(labels).toContain('Budget cook') // goal
  })

  it('an empty form draft yields no badges (no swipe leftovers)', () => {
    const { profile } = draftToHousehold(EMPTY_DRAFT)
    expect(deriveBadges(profile)).toEqual([])
  })
})
