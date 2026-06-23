/**
 * Whether an AH/Jumbo catalogue row is a weeknight dinner candidate.
 *
 * The DB defaults `mealType` to 'dinner', so imported snacks, sides, breakfasts,
 * and desserts must be filtered by category and title. `hoofdgerecht` is always
 * a main unless the title is an obvious non-dinner (crackers, smoothie, …).
 * Dutch category labels (`bijgerecht`, `ontbijt`, `tussendoortje`, …) are first-class.
 */

import removedAhJumboRecipeIds from '../../data/seed/removed-ah-jumbo-recipe-ids.json'

/** AH/Jumbo recipe ids dropped from the dinner catalogue (non-dinner rows). */
export const REMOVED_AH_JUMBO_RECIPE_IDS: ReadonlyArray<string> =
  removedAhJumboRecipeIds

export interface DinnerRecipeFields {
  title: string
  category?: string | null
}

export const NON_DINNER_CATEGORY_FRAGMENTS: ReadonlyArray<string> = [
  'bijgerecht',
  'nagerecht',
  'ontbijt',
  'dessert',
  'tussendoortje',
  'lunch/brunch',
  'snack',
  'drank',
  'breakfast',
  'brunch',
  'beverage',
  'side dish',
  'side',
  'sweet',
  'appetiz',
  'appetis',
  'starter',
  'sauce',
  'condiment',
  'dip',
  'spread',
  'bread',
  'cracker',
  'drink',
  'cocktail',
]

/** Whole-title or whole-word patterns for rows with a missing or generic category. */
const NON_DINNER_TITLE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcrackers?\b/i,
  /\bijsjes?\b/i,
  /\bijskoffie\b/i,
  /\bsmoothie\b/i,
  /\bontbijt\b/i,
  /\bbroodje\b/i,
  /\bhotdog\b/i,
  /\bcookies?\b/i,
  /\bcheesecake/i,
  /\bpannenkoekentaart\b/i,
  /\bovernight oats\b/i,
  /\bkwark met\b/i,
  /\byoghurt met\b/i,
  /\btrifle\b/i,
  /\bslushpuppie\b/i,
  /\bmilkshake\b/i,
  /\blunch wrap\b/i,
  /\bflammkuchen\b/i,
  /\bpannenkoeken met\b/i,
  /^gado gado saus$/i,
  /^simpele maar heerlijke pastasaus$/i,
  /\bpeercrumble\b/i,
  /\bappel-peercrumble\b/i,
]

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** True when the imported category marks a non-dinner item. */
export function categoryIsNonDinner(
  category: string | null | undefined,
): boolean {
  const cat = category ? normalise(category) : ''
  if (!cat || cat === 'hoofdgerecht') return false
  return NON_DINNER_CATEGORY_FRAGMENTS.some((t) => cat.includes(t))
}

/** True when the title alone marks an obvious non-dinner (EN + NL). */
export function titleIsNonDinner(title: string): boolean {
  return NON_DINNER_TITLE_PATTERNS.some((p) => p.test(title))
}

/** True when this AH/Jumbo row belongs in the dinner catalogue. */
export function isDinnerRecipe(r: DinnerRecipeFields): boolean {
  if (categoryIsNonDinner(r.category)) return false
  if (titleIsNonDinner(r.title)) return false
  return true
}
