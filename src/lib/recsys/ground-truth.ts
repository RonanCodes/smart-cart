import type { RecipeLite, UserProfile } from './types'

/**
 * The hidden truth: how much a synthetic user actually likes a recipe. The
 * benchmark uses this to (a) simulate swipes and (b) define each user's true
 * top-N, which the recommenders are scored against. The recommenders never see
 * this function; they only see the simulated like/dislike swipes.
 *
 * Mirrors CONTEXT.md's Planner policy: vegetarian is effectively a hard filter
 * (a large negative), while cuisine, ingredients, prep-time and calorie goals are
 * soft scoring nudges. Every weight is a fixed constant and every input is read
 * straight off the user/recipe, so the function is fully deterministic.
 */
export function trueScore(user: UserProfile, recipe: RecipeLite): number {
  let s = 0
  if (recipe.cuisine && user.lovedCuisines.includes(recipe.cuisine)) s += 3
  if (recipe.cuisine && user.dislikedCuisines.includes(recipe.cuisine)) s -= 3
  const ingredientText = recipe.ingredients
    .map((i) => i.name.toLowerCase())
    .join(' ')
  for (const dis of user.dislikedIngredients) {
    if (ingredientText.includes(dis)) s -= 2
  }
  for (const lov of user.lovedIngredients) {
    if (ingredientText.includes(lov)) s += 2
  }
  if (user.vegetarian && !recipe.dietaryTags.includes('vegetarian')) s -= 4

  // Soft prep-time nudge. Only applies when the user expressed a preference and
  // the recipe records a prep time. A quick-cook user likes fast recipes and
  // dislikes slow ones; we leave unknown-prep recipes untouched.
  if (
    user.maxPrepMinutes != null &&
    recipe.prepMinutes != null &&
    recipe.prepMinutes > 0
  ) {
    if (recipe.prepMinutes <= user.maxPrepMinutes) s += 1
    else if (recipe.prepMinutes > user.maxPrepMinutes * 2) s -= 2
    else s -= 1
  }

  // Soft calorie nudge. `lighter` users prefer low-calorie dinners; `hearty`
  // users prefer richer ones. Unknown calories are untouched.
  if (
    user.caloriePreference &&
    recipe.calories != null &&
    recipe.calories > 0
  ) {
    const light = recipe.calories <= 450
    const heavy = recipe.calories >= 650
    if (user.caloriePreference === 'lighter') s += light ? 1 : heavy ? -1 : 0
    else s += heavy ? 1 : light ? -1 : 0
  }

  return s
}

/** What the user does when shown a recipe: like if they genuinely would. */
export function simulateSwipe(user: UserProfile, recipe: RecipeLite): boolean {
  return trueScore(user, recipe) > 0
}

/** The user's true top-N recipes (the target the recommenders try to reach). */
export function trueTopN(
  user: UserProfile,
  recipes: Array<RecipeLite>,
  n: number,
): Array<string> {
  return [...recipes]
    .map((r) => ({ id: r.id, s: trueScore(user, r) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.id)
}
