import type { OnboardingDraft } from '#/components/onboarding/form-state'
import { clampHouseholdCount } from './onboarding-rhythm'

/**
 * Pure mapping from the Jow-style onboarding draft to the persisted household
 * columns + profile json. No DB, no server deps — the form is the data source
 * and this is the single place that decides how an answer becomes a stored
 * field, so the planner reads one consistent shape (#110, PRD #104).
 *
 * Why a pure function: persistence and week-generation both need the same
 * mapping, and the mapping is the load-bearing glue between "what the user
 * tapped" and "what the planner filters on". Keeping it pure makes it unit
 * testable without a database.
 */

/** Profile fields the planner + app read. Mirrors household.profile in schema. */
export interface MappedProfile {
  /** Ingredient substrings to exclude (hard filter via planner allergy gate). */
  allergies: Array<string>
  /** The user-facing dislike pills, preserved verbatim for display. */
  dislikes: Array<string>
  /** Single diet string the planner's veg gate reads ('vegan' | 'vegetarian'). */
  diet?: string
  /** Kitchen appliances — gates recipe feasibility (soft / best-effort today). */
  equipment: Array<string>
  /** Soft goals — soft weighting in the planner, never a hard filter. */
  goals: Array<string>
  /** Cuisines the household likes — a soft planner up-weight, never a filter. */
  cuisinesLiked: Array<string>
  /** Cuisines the household hates — a soft planner down-weight, never a filter. */
  cuisinesDisliked: Array<string>
  /** Pets, captured for portion / leftover sizing. */
  pets: { cats: number; dogs: number }
  /** Children ages (years) — sizes child portions. */
  childrenAges: Array<number>
}

export interface MappedHousehold {
  adults: number
  children: number
  /** Only set when the draft store is a real selectable store ('ah' | 'jumbo').
   * Picnic (draft.store === null, the CTO joke) and an unanswered step are left
   * undefined so the caller keeps the existing/default store. */
  preferredStore?: 'ah' | 'jumbo'
  profile: MappedProfile
}

/** Stores we actually fulfil. Picnic is the joke; null/anything else is ignored. */
const REAL_STORES = new Set(['ah', 'jumbo'])

/**
 * Diet labels the planner CAN hard-filter via dietary tags, in priority order.
 * The planner profile holds ONE diet string and its veg gate only understands
 * 'vegan' / 'vegetarian', so we collapse the multi-select to the strictest of
 * those it can enforce. 'vegan' wins over 'vegetarian' (it is the tighter gate).
 */
const TAG_DIETS: ReadonlyArray<string> = ['vegan', 'vegetarian']

/**
 * Diet labels we can only enforce as ingredient exclusions (no clean dietary
 * tag in the catalogue), mapped to the ingredient substrings to avoid. These
 * feed the same hard allergy gate as dislikes — a best-effort hard filter, not
 * a perfect one (a recipe that hides dairy under "parmesan" still needs the
 * catalogue to spell it). Left deliberately small + obvious; widen with data.
 */
const EXCLUSION_DIETS: Record<string, ReadonlyArray<string>> = {
  'dairy free': ['milk', 'cheese', 'butter', 'cream', 'yoghurt', 'yogurt'],
  'gluten free': ['wheat', 'flour', 'bread', 'pasta', 'noodle', 'couscous'],
  porkless: ['pork', 'ham', 'bacon', 'prosciutto', 'chorizo'],
}

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/**
 * Map the onboarding draft to the household row + profile. Pure: same input,
 * same output, no side effects. The server fn calls this then writes the result.
 */
export function draftToHousehold(draft: OnboardingDraft): MappedHousehold {
  const adults = clampHouseholdCount(draft.adults, 1)
  const children = clampHouseholdCount(draft.children, 0)

  const store = draft.store ? normalise(draft.store) : null
  const preferredStore =
    store && REAL_STORES.has(store) ? (store as 'ah' | 'jumbo') : undefined

  const dietLabels = draft.diet.map(normalise)

  // The single diet string the planner's tag gate reads: strictest tag-diet the
  // user picked, else undefined (no veg gate).
  const diet = TAG_DIETS.find((d) => dietLabels.includes(d))

  // Ingredient exclusions = explicit dislikes + the exclusion-only diet labels.
  // Deduped, lowercased; this is the hard allergy gate the planner runs.
  const dislikeExclusions = draft.dislikes.map(normalise).filter(Boolean)
  const dietExclusions = dietLabels.flatMap((d) => EXCLUSION_DIETS[d] ?? [])
  const allergies = Array.from(
    new Set([...dislikeExclusions, ...dietExclusions]),
  )

  // Cuisine preferences: normalised, deduped, and never overlapping (a like
  // wins over a hate for the same cuisine). The planner reads these as a soft
  // up/down weight; empty lists leave ranking unchanged.
  const cuisinesLiked = Array.from(
    new Set(draft.cuisinesLiked.map(normalise).filter(Boolean)),
  )
  const likedSet = new Set(cuisinesLiked)
  const cuisinesDisliked = Array.from(
    new Set(draft.cuisinesDisliked.map(normalise).filter(Boolean)),
  ).filter((c) => !likedSet.has(c))

  return {
    adults,
    children,
    preferredStore,
    profile: {
      allergies,
      // Keep the user's own dislike words for display ("no anchovies"); the
      // exclusions above are what the planner matches on.
      dislikes: dislikeExclusions,
      diet,
      equipment: [...draft.equipment],
      goals: [...draft.goals],
      cuisinesLiked,
      cuisinesDisliked,
      pets: { cats: draft.pets.cats, dogs: draft.pets.dogs },
      childrenAges: [...draft.childrenAges],
    },
  }
}
