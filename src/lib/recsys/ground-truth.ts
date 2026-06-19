import type { RecipeLite, UserProfile } from './types'

/**
 * The hidden truth: how much a synthetic user actually likes a recipe. The
 * benchmark uses this to (a) simulate swipes and (b) define each user's true
 * top-N, which the recommenders are scored against. The recommenders never see
 * this function; they only see the simulated like/dislike swipes.
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
