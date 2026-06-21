/**
 * Maps a free-text ingredient / shopping-list name to a coarse aisle category,
 * so the Cart screen can group rows into airy hairline sections (Produce, Dairy
 * & cheese, Meat & fish, ...) the way a real shop is laid out (#cart-align).
 *
 * This is the grouping the design prototype faked with a hardcoded GROUPS const.
 * Here it is derived from the REAL item names, keyword-first, mirroring the
 * substring approach in `ingredient-sticker.ts`. The first matching keyword
 * wins, so specific terms come before their fallbacks. Anything we can't place
 * falls into "Other" so every item still renders under a heading.
 *
 * Pure: no DB, no I/O, no React. Unit-tested in ingredient-category.test.ts.
 */

/** The aisle buckets, in the order they should appear on the Cart screen. */
export const CATEGORY_ORDER = [
  'Produce',
  'Meat & fish',
  'Dairy & cheese',
  'Bakery',
  'Pantry',
  'Other',
] as const

export type IngredientCategory = (typeof CATEGORY_ORDER)[number]

/** [keyword to find in the name, category]. Order = priority (first wins). */
const KEYWORDS: ReadonlyArray<readonly [string, IngredientCategory]> = [
  // Dairy & cheese (before "Produce" so e.g. "cream" never reads as produce).
  ['parmesan', 'Dairy & cheese'],
  ['feta', 'Dairy & cheese'],
  ['mozzarella', 'Dairy & cheese'],
  ['cheddar', 'Dairy & cheese'],
  ['ricotta', 'Dairy & cheese'],
  ['cheese', 'Dairy & cheese'],
  ['milk', 'Dairy & cheese'],
  ['yoghurt', 'Dairy & cheese'],
  ['yogurt', 'Dairy & cheese'],
  ['cream', 'Dairy & cheese'],
  ['butter', 'Dairy & cheese'],
  ['egg', 'Dairy & cheese'],
  // Meat & fish.
  ['chicken', 'Meat & fish'],
  ['beef', 'Meat & fish'],
  ['pork', 'Meat & fish'],
  ['mince', 'Meat & fish'],
  ['bacon', 'Meat & fish'],
  ['sausage', 'Meat & fish'],
  ['salmon', 'Meat & fish'],
  ['tuna', 'Meat & fish'],
  ['cod', 'Meat & fish'],
  ['fish', 'Meat & fish'],
  ['shrimp', 'Meat & fish'],
  ['prawn', 'Meat & fish'],
  ['mussel', 'Meat & fish'],
  // Produce.
  ['tomato', 'Produce'],
  ['onion', 'Produce'],
  ['garlic', 'Produce'],
  ['lemon', 'Produce'],
  ['lime', 'Produce'],
  ['spinach', 'Produce'],
  ['mushroom', 'Produce'],
  ['avocado', 'Produce'],
  ['basil', 'Produce'],
  ['cilantro', 'Produce'],
  ['coriander', 'Produce'],
  ['parsley', 'Produce'],
  ['pepper', 'Produce'],
  ['courgette', 'Produce'],
  ['zucchini', 'Produce'],
  ['aubergine', 'Produce'],
  ['eggplant', 'Produce'],
  ['carrot', 'Produce'],
  ['potato', 'Produce'],
  ['broccoli', 'Produce'],
  ['cucumber', 'Produce'],
  ['lettuce', 'Produce'],
  ['ginger', 'Produce'],
  ['chilli', 'Produce'],
  ['chili', 'Produce'],
  ['apple', 'Produce'],
  ['banana', 'Produce'],
  // Bakery.
  ['bread', 'Bakery'],
  ['baguette', 'Bakery'],
  ['ciabatta', 'Bakery'],
  ['bun', 'Bakery'],
  ['roll', 'Bakery'],
  ['tortilla', 'Bakery'],
  ['wrap', 'Bakery'],
  ['naan', 'Bakery'],
  ['pita', 'Bakery'],
  // Pantry.
  ['olive oil', 'Pantry'],
  ['oil', 'Pantry'],
  ['orzo', 'Pantry'],
  ['gnocchi', 'Pantry'],
  ['spaghetti', 'Pantry'],
  ['penne', 'Pantry'],
  ['noodle', 'Pantry'],
  ['macaroni', 'Pantry'],
  ['lasagne', 'Pantry'],
  ['lasagna', 'Pantry'],
  ['pasta', 'Pantry'],
  ['rice', 'Pantry'],
  ['flour', 'Pantry'],
  ['sugar', 'Pantry'],
  ['salt', 'Pantry'],
  ['stock', 'Pantry'],
  ['bouillon', 'Pantry'],
  ['bean', 'Pantry'],
  ['lentil', 'Pantry'],
  ['chickpea', 'Pantry'],
  ['tomatoes tin', 'Pantry'],
  ['vinegar', 'Pantry'],
  ['soy sauce', 'Pantry'],
  ['almond', 'Pantry'],
  ['walnut', 'Pantry'],
  ['cashew', 'Pantry'],
  ['peanut', 'Pantry'],
  ['hazelnut', 'Pantry'],
  ['tofu', 'Pantry'],
]

/**
 * Match each keyword as a whole word (allowing a simple plural), same rule as
 * ingredient-sticker.ts, so "egg" doesn't hit "eggplant" (which is its own
 * Produce keyword) and short words don't bleed. Compiled once at module load.
 */
const MATCHERS: ReadonlyArray<readonly [RegExp, IngredientCategory]> =
  KEYWORDS.map(
    ([keyword, category]) =>
      [new RegExp(`\\b${keyword}(e?s)?\\b`), category] as const,
  )

/** The aisle category for one ingredient name. Defaults to "Other". */
export function ingredientCategory(name: string): IngredientCategory {
  const n = name.toLowerCase()
  for (const [matcher, category] of MATCHERS) {
    if (matcher.test(n)) return category
  }
  return 'Other'
}

/**
 * Group a list of items by aisle category, in CATEGORY_ORDER, dropping empty
 * categories. Item order WITHIN a group is preserved (the list arrives
 * oldest-first / list-order), so grouping never reshuffles a user's rows beyond
 * pulling like with like. Generic over the row shape; the caller passes a
 * `name` accessor.
 */
export function groupByCategory<T>(
  items: ReadonlyArray<T>,
  getName: (item: T) => string,
): Array<{ category: IngredientCategory; items: Array<T> }> {
  const buckets = new Map<IngredientCategory, Array<T>>()
  for (const item of items) {
    const cat = ingredientCategory(getName(item))
    const bucket = buckets.get(cat)
    if (bucket) bucket.push(item)
    else buckets.set(cat, [item])
  }
  return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    items: buckets.get(category)!,
  }))
}
