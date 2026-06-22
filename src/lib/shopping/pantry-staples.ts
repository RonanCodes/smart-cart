/**
 * Pantry-staple classifier (#cart-staples).
 *
 * A pantry staple is something most households already keep in the cupboard:
 * salt, ground spices, oil, flour, sugar, vanilla, baking soda, and so on. A
 * recipe that wants "1 tsp vanilla extract" should NOT push a EUR 8.99 bottle
 * into the order set, so a recognised staple is added to the list but defaults
 * to UNticked (the user ticks it in if they actually need to buy it).
 *
 * The model is deliberately conservative: a name is a staple only when it
 * clearly is one of the well-known cupboard items below. Anything fresh (meat,
 * fish, dairy, produce) is NEVER a staple, even if it shares a word with one
 * (e.g. "garlic salt" is a staple, but "salted butter" is dairy, not a staple).
 *
 * Pure: no DB, no I/O. Reuses `normaliseItemName` so matching is identical to
 * the de-dupe layer (trimmed, lower-cased, inner whitespace collapsed).
 */

import { normaliseItemName } from './persist'

/**
 * Fresh-ingredient guards. If the normalised name contains any of these as a
 * whole word, it is a fresh product and never a staple, regardless of any
 * staple keyword it might also contain. Keeps "salted butter" (dairy),
 * "sugar snap peas" (produce), and "honey-glazed ham" (meat) out.
 */
const FRESH_GUARDS: ReadonlyArray<string> = [
  'butter',
  'cheese',
  'milk',
  'cream',
  'yoghurt',
  'yogurt',
  'egg',
  'eggs',
  'chicken',
  'beef',
  'pork',
  'lamb',
  'ham',
  'bacon',
  'sausage',
  'fish',
  'salmon',
  'prawn',
  'shrimp',
  'tofu',
  'snap',
  'snaps',
]

/**
 * Exact normalised names that ARE staples. Matched whole so a bare "salt" or
 * "olive oil" qualifies without over-matching a longer fresh name.
 */
const EXACT_STAPLES: ReadonlySet<string> = new Set([
  'salt',
  'sea salt',
  'table salt',
  'kosher salt',
  'garlic salt',
  'pepper',
  'black pepper',
  'white pepper',
  'ground black pepper',
  'cumin',
  'ground cumin',
  'paprika',
  'smoked paprika',
  'cinnamon',
  'ground cinnamon',
  'oregano',
  'dried oregano',
  'basil',
  'dried basil',
  'thyme',
  'dried thyme',
  'rosemary',
  'turmeric',
  'ground turmeric',
  'curry powder',
  'nutmeg',
  'ground nutmeg',
  'coriander',
  'ground coriander',
  'chilli flakes',
  'chili flakes',
  'chilli powder',
  'chili powder',
  'red pepper flakes',
  'cayenne',
  'cayenne pepper',
  'oil',
  'olive oil',
  'extra virgin olive oil',
  'mild olive oil',
  'sunflower oil',
  'vegetable oil',
  'coconut oil',
  'rapeseed oil',
  'sesame oil',
  'vinegar',
  'white wine vinegar',
  'red wine vinegar',
  'balsamic vinegar',
  'rice vinegar',
  'apple cider vinegar',
  'flour',
  'plain flour',
  'all purpose flour',
  'all-purpose flour',
  'almond flour',
  'self raising flour',
  'self-raising flour',
  'bread flour',
  'sugar',
  'white sugar',
  'brown sugar',
  'caster sugar',
  'icing sugar',
  'granulated sugar',
  'coconut blossom sugar',
  'coconut sugar',
  'vanilla',
  'vanilla extract',
  'vanilla essence',
  'baking soda',
  'bicarbonate of soda',
  'baking powder',
  'honey',
  'maple syrup',
  'soy sauce',
  'ketjap manis',
  'stock cube',
  'stock cubes',
  'bouillon',
  'bouillon cube',
  'bouillon cubes',
  'vegetable stock cube',
  'chicken stock cube',
  'cornflour',
  'cornstarch',
  'corn starch',
  'mustard',
  'dijon mustard',
  'wholegrain mustard',
])

/**
 * Multi-word phrases that mark a staple anywhere in the name, so "extra virgin
 * olive oil for frying" or "good balsamic vinegar" still classify. Each phrase
 * is specific enough that a fresh product would not contain it; the single
 * ambiguous words (salt, oil, flour, sugar, vinegar, mustard, honey) are handled
 * via the trailing-word check below, NOT here.
 */
const STAPLE_PHRASES: ReadonlyArray<string> = [
  'olive oil',
  'sunflower oil',
  'vegetable oil',
  'coconut oil',
  'rapeseed oil',
  'sesame oil',
  'wine vinegar',
  'balsamic vinegar',
  'rice vinegar',
  'cider vinegar',
  'curry powder',
  'chilli flakes',
  'chili flakes',
  'chilli powder',
  'chili powder',
  'pepper flakes',
  'baking soda',
  'baking powder',
  'bicarbonate of soda',
  'maple syrup',
  'soy sauce',
  'ketjap manis',
  'stock cube',
  'bouillon',
  'vanilla extract',
  'vanilla essence',
  'dijon mustard',
  'plain flour',
  'almond flour',
  'self raising flour',
  'self-raising flour',
  'bread flour',
  'caster sugar',
  'icing sugar',
  'brown sugar',
  'coconut sugar',
  'coconut blossom sugar',
]

/**
 * True when the normalised name is a well-known cupboard staple, so the cart can
 * add it UNticked ("you likely have this") rather than pricing a whole bottle /
 * jar for a teaspoon. Conservative by design: matches the curated set above and
 * a small number of unambiguous trailing-word phrases, and never a fresh
 * produce / meat / dairy ingredient.
 */
export function isPantryStaple(name: string): boolean {
  const n = normaliseItemName(name)
  if (n === '') return false

  // A fresh-ingredient word anywhere disqualifies, before any staple match.
  const words = n.split(' ')
  if (FRESH_GUARDS.some((g) => words.includes(g))) return false

  if (EXACT_STAPLES.has(n)) return true
  if (STAPLE_PHRASES.some((p) => n.includes(p))) return true

  return false
}
