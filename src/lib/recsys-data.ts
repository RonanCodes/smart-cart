import type { RecipeLite } from './recsys/types'

/** A swipe card for the UI: enough to render, no instructions. */
export interface DeckCard {
  id: string
  title: string
  cuisine: string | null
  imageUrl: string | null
  /** Prep time in minutes, when known (shown as a "25 min" chip). */
  prepMinutes: number | null
  /** A few key ingredients so an unfamiliar dish is still clear at a glance. */
  ingredients: Array<string>
}

/** Generic pantry staples that do not help identify a dish. Skipped on the card. */
const PANTRY_STAPLES = new Set(['sugar', 'butter', 'flour'])

/**
 * Noise words: when one appears as a WORD in the ingredient name it is filler, so
 * skip the whole ingredient. Catches descriptor variants like "warm water", "olive
 * oil", "vegetable oil". Kept narrow so meaningful names ("peanut butter", "tomato
 * paste") survive (those go through PANTRY_STAPLES exact-match instead).
 */
const NOISE_WORDS = new Set(['water', 'oil', 'salt', 'pepper'])

function isNoise(name: string): boolean {
  const key = name.toLowerCase()
  if (PANTRY_STAPLES.has(key)) return true
  const words = key.split(/[^a-z]+/).filter(Boolean)
  return words.some((w) => NOISE_WORDS.has(w))
}

/** Up to `n` distinct, meaningful ingredient names for the card. */
function keyIngredients(
  ingredients: Array<{ name: string }>,
  n = 4,
): Array<string> {
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const { name } of ingredients) {
    const clean = name.trim()
    const key = clean.toLowerCase()
    if (!clean || seen.has(key) || isNoise(clean)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= n) break
  }
  return out
}

/**
 * Load the recipe catalogue from D1 in the shape the recommender needs, plus a
 * lookup of render cards. Cheap enough to do per request at this catalogue size;
 * for a much larger catalogue this would move behind a cache or an index (see
 * ADR-0003 for the escape hatch).
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
      prepMinutes: recipe.prepMinutes,
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
      prepMinutes: r.prepMinutes,
      ingredients: keyIngredients(r.ingredients),
    })
  }
  return { recipes, cards }
}
