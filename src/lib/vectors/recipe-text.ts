/**
 * Pure (runtime-free) canonical text representation of a recipe.
 *
 * The text is `title + cuisine + ingredients` (recipe steps are deliberately
 * excluded as noisy). Used by the set-maths similarity scorer (similar-score.ts)
 * to tokenise both the query and candidate recipes, so "similar recipes" compares
 * like for like. No `cloudflare:workers` binding, so tests import it freely.
 */

export interface RecipeForEmbedding {
  title: string
  cuisine: string | null
  ingredients: Array<{ name: string }>
}

/**
 * The text we embed for a recipe: title, cuisine, then the ingredient names.
 * Falsy parts are dropped so a missing cuisine does not leave a dangling
 * separator. Steps are intentionally omitted.
 */
export function recipeText(r: RecipeForEmbedding): string {
  return [r.title, r.cuisine ?? '', r.ingredients.map((i) => i.name).join(', ')]
    .filter(Boolean)
    .join('. ')
}
