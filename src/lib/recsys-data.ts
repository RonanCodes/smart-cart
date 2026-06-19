import type { RecipeLite } from './recsys/types'

/** A swipe card for the UI: enough to render, no instructions. */
export interface DeckCard {
  id: string
  title: string
  cuisine: string | null
  imageUrl: string | null
}

/**
 * Load the recipe catalogue from D1 in the shape the recommender needs, plus a
 * lookup of render cards. Cheap enough to do per request at this catalogue size;
 * for a much larger catalogue this would move behind Vectorize + a cache.
 */
export async function loadCatalogue(): Promise<{
  recipes: Array<RecipeLite>
  cards: Map<string, DeckCard>
}> {
  const { getDb } = await import('../db/client')
  const { recipe } = await import('../db/schema')
  const { hasImage } = await import('../db/recipe-filters')
  const db = await getDb()
  const rows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      cuisine: recipe.cuisine,
      category: recipe.category,
      dietaryTags: recipe.dietaryTags,
      ingredients: recipe.ingredients,
      raw: recipe.raw,
    })
    .from(recipe)
    // Only ever serve recipes with an image (deck/plan/swap cards).
    .where(hasImage)
  const recipes: Array<RecipeLite> = []
  const cards = new Map<string, DeckCard>()
  for (const r of rows) {
    recipes.push({
      id: r.id,
      title: r.title,
      cuisine: r.cuisine,
      category: r.category,
      dietaryTags: r.dietaryTags,
      ingredients: r.ingredients.map((i) => ({ name: i.name })),
    })
    const raw = r.raw as { imageUrl?: string | null } | null
    cards.set(r.id, {
      id: r.id,
      title: r.title,
      cuisine: r.cuisine,
      imageUrl: raw?.imageUrl ?? null,
    })
  }
  return { recipes, cards }
}
