/**
 * Common-dislikes catalogue + a pure suggestion filter for the onboarding
 * Dislikes step (issue #173).
 *
 * The Dislikes step shows a fixed set of preset chips (Shellfish, Nuts, Egg, …)
 * and lets the user type any other ingredient into a free-text box. This module
 * powers an autocomplete dropdown under that box: as the user types, we suggest
 * matches from a curated list of commonly-disliked ingredients, EXCLUDING the
 * preset chips already on screen and anything the user has already selected.
 *
 * The catalogue is English-first (the app UI is EN) with a handful of Dutch
 * terms sprinkled in, since the product catalogue is sourced from Albert Heijn /
 * Jumbo and users may well think in Dutch for some staples. Matching is plain
 * case-insensitive substring, so 'brod' surfaces 'Broccoli' and 'ui' surfaces
 * 'Ui (onion)'.
 *
 * `suggestDislikes` is intentionally pure and side-effect free so it is trivial
 * to unit-test and to call on every keystroke.
 */

/**
 * Curated list of commonly-disliked / commonly-avoided ingredients.
 *
 * Grouped loosely for readability (allergens, strong-flavour items, veg,
 * proteins, herbs/spices, dairy/misc). Stored verbatim with display casing; the
 * step stores whatever string is tapped, matching its existing free-text add.
 */
export const COMMON_DISLIKES: ReadonlyArray<string> = [
  // Allergens / often-avoided proteins
  'Shellfish',
  'Shrimp',
  'Prawns',
  'Crab',
  'Lobster',
  'Mussels',
  'Oysters',
  'Squid',
  'Octopus',
  'Anchovies',
  'Sardines',
  'Tuna',
  'Salmon',
  'Mackerel',
  'Herring',
  'Cod',
  'Peanuts',
  'Almonds',
  'Walnuts',
  'Cashews',
  'Hazelnuts',
  'Pistachios',
  'Pine nuts',
  'Sesame',
  'Tahini',
  // Strong-flavour / polarising
  'Blue cheese',
  'Goat cheese',
  'Feta',
  'Capers',
  'Anise',
  'Liquorice',
  'Fennel',
  'Beetroot',
  'Brussels sprouts',
  'Aubergine',
  'Eggplant',
  'Courgette',
  'Zucchini',
  'Okra',
  'Radish',
  'Turnip',
  'Sauerkraut',
  'Kimchi',
  'Pickles',
  'Gherkins',
  'Horseradish',
  'Wasabi',
  'Mustard',
  'Vinegar',
  'Truffle',
  // Veg / produce
  'Broccoli',
  'Cauliflower',
  'Cabbage',
  'Kale',
  'Spinach',
  'Leek',
  'Celery',
  'Asparagus',
  'Artichoke',
  'Avocado',
  'Cucumber',
  'Bell pepper',
  'Chilli',
  'Jalapeno',
  'Sweet potato',
  'Pumpkin',
  'Squash',
  'Peas',
  'Green beans',
  'Lentils',
  'Chickpeas',
  'Kidney beans',
  'Black beans',
  'Tofu',
  'Tempeh',
  'Seitan',
  // Proteins / meats
  'Pork',
  'Bacon',
  'Ham',
  'Sausage',
  'Liver',
  'Kidney',
  'Lamb',
  'Veal',
  'Duck',
  'Game',
  'Offal',
  // Herbs / spices / aromatics
  'Basil',
  'Parsley',
  'Dill',
  'Mint',
  'Rosemary',
  'Thyme',
  'Sage',
  'Oregano',
  'Tarragon',
  'Curry',
  'Cumin',
  'Turmeric',
  'Paprika',
  'Cinnamon',
  'Cardamom',
  'Cloves',
  'Nutmeg',
  'Ginger',
  'Saffron',
  // Dairy / misc
  'Cream',
  'Yoghurt',
  'Buttermilk',
  'Mayonnaise',
  'Coconut',
  'Raisins',
  'Dates',
  'Prunes',
  'Honey',
  'Marzipan',
  // A few Dutch terms (AH / Jumbo catalogue)
  'Ui (onion)',
  'Knoflook (garlic)',
  'Spruitjes (sprouts)',
  'Witlof (chicory)',
  'Zuurkool (sauerkraut)',
  'Haring (herring)',
  'Lever (liver)',
  'Spek (bacon)',
]

export interface SuggestDislikesContext {
  /** Preset chips already visible on the step (excluded from suggestions). */
  shown: ReadonlyArray<string>
  /** Ingredients the user has already selected (excluded from suggestions). */
  selected: ReadonlyArray<string>
}

/** Default cap on how many suggestions to surface under the input. */
export const MAX_SUGGESTIONS = 8

/**
 * Pure suggestion filter for the dislikes autocomplete.
 *
 * Returns up to `limit` entries from COMMON_DISLIKES that contain `query` as a
 * case-insensitive substring, excluding anything in `shown` or `selected`
 * (matched case-insensitively). An empty / whitespace-only query returns no
 * suggestions, so the dropdown only appears once the user starts typing.
 *
 * Matches preserve the catalogue order, with prefix matches floated to the top
 * so 'on' surfaces 'Onion'-like staples ahead of mid-word hits.
 */
export function suggestDislikes(
  query: string,
  { shown, selected }: SuggestDislikesContext,
  limit: number = MAX_SUGGESTIONS,
): Array<string> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const excluded = new Set(
    [...shown, ...selected].map((s) => s.trim().toLowerCase()),
  )

  const matches = COMMON_DISLIKES.filter((item) => {
    const lower = item.toLowerCase()
    return lower.includes(q) && !excluded.has(lower)
  })

  // Prefix matches first (stable within each group via the original order).
  const prefix: Array<string> = []
  const rest: Array<string> = []
  for (const item of matches) {
    if (item.toLowerCase().startsWith(q)) prefix.push(item)
    else rest.push(item)
  }

  return [...prefix, ...rest].slice(0, limit)
}
