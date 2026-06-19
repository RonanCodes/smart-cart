/**
 * Pure (runtime-free) embedding-text construction for recipes.
 *
 * Lives in its own module so the build-time embed script (scripts/embed-recipes.ts)
 * and unit tests can import it without pulling in the `cloudflare:workers` runtime
 * binding that src/lib/vectors/index.ts needs. Per ADR-0001 the embedding text is
 * `title + cuisine + ingredients` (recipe steps are deliberately excluded: noisy).
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
