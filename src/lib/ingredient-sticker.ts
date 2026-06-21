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
  ['peanut', 'nuts'],
  ['hazelnut', 'nuts'],
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

/**
 * Match each keyword as a whole word (allowing a simple "s"/"es" plural) rather
 * than a raw substring, so short keywords stop bleeding into longer unrelated
 * words: "egg" no longer hits "eggplant", "nut" no longer hits "butternut". The
 * compound terms we DO want ("peanut", "hazelnut") are listed explicitly above.
 * Compiled once at module load.
 */
const MATCHERS: ReadonlyArray<readonly [RegExp, string]> = KEYWORDS.map(
  ([keyword, slug]) => [new RegExp(`\\b${keyword}(e?s)?\\b`), slug] as const,
)

export function ingredientSticker(name: string): string | null {
  const n = name.toLowerCase()
  for (const [matcher, slug] of MATCHERS) {
    if (matcher.test(n)) return `/stickers/ingredients/${slug}.png`
  }
  return null
}
