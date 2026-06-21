/**
 * Maps a free-text ingredient / shopping-list name to one of the cut-out product
 * stickers in public/stickers/ingredients. Real list items are messy ("Vine
 * tomatoes", "Feta", "Salmon fillet"), so we match on keyword substrings rather
 * than exact slugs. The first matching keyword wins, so more specific terms
 * (parmesan, feta) are listed before their fallbacks (cheese).
 *
 * Returns a public path like "/stickers/ingredients/tomato.png", or null when we
 * have no sticker for it (the caller shows a neutral tile instead).
 */

/** [keyword to find in the name, sticker slug to use]. Order = priority. */
const KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['olive oil', 'olive-oil'],
  ['parmesan', 'parmesan'],
  ['feta', 'cheese'],
  ['mozzarella', 'cheese'],
  ['cheddar', 'cheese'],
  ['ricotta', 'cheese'],
  ['cheese', 'cheese'],
  ['milk', 'dairy'],
  ['yoghurt', 'dairy'],
  ['yogurt', 'dairy'],
  ['cream', 'dairy'],
  ['butter', 'dairy'],
  ['tomato', 'tomato'],
  ['onion', 'onion'],
  ['garlic', 'garlic'],
  ['lemon', 'lemon'],
  ['spinach', 'spinach'],
  ['mushroom', 'mushroom'],
  ['avocado', 'avocado'],
  ['basil', 'basil'],
  ['cilantro', 'cilantro'],
  ['coriander', 'coriander'],
  ['pepper', 'pepper'],
  ['chicken', 'chicken'],
  ['salmon', 'fish'],
  ['tuna', 'fish'],
  ['cod', 'fish'],
  ['fish', 'fish'],
  ['shrimp', 'shellfish'],
  ['prawn', 'shellfish'],
  ['mussel', 'shellfish'],
  ['shellfish', 'shellfish'],
  ['almond', 'nuts'],
  ['walnut', 'nuts'],
  ['cashew', 'nuts'],
  ['nut', 'nuts'],
  ['tofu', 'soy'],
  ['soy', 'soy'],
  ['spaghetti', 'pasta'],
  ['penne', 'pasta'],
  ['orzo', 'pasta'],
  ['gnocchi', 'pasta'],
  ['noodle', 'pasta'],
  ['macaroni', 'pasta'],
  ['orecchiette', 'pasta'],
  ['lasagne', 'pasta'],
  ['lasagna', 'pasta'],
  ['pasta', 'pasta'],
  ['egg', 'egg'],
]

export function ingredientSticker(name: string): string | null {
  const n = name.toLowerCase()
  for (const [keyword, slug] of KEYWORDS) {
    if (n.includes(keyword)) return `/stickers/ingredients/${slug}.png`
  }
  return null
}
