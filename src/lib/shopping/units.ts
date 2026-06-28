/**
 * Unit normalisation.
 *
 * Recipes write the same physical thing many ways: 'g' / 'gram' / 'grams',
 * 'kg', 'ml' / 'l', 'tsp' / 'teaspoon', 'tbsp'. To add two amounts we first
 * normalise both to a canonical BASE unit per dimension (grams, millilitres,
 * millilitres-for-spoons, or a dimensionless 'count'), add in the base, then
 * render back in a sensible display unit.
 *
 * We deliberately keep dimensions separate and NEVER convert across them
 * (mass vs volume vs spoons vs count). A 'g' total and an 'ml' total stay as two
 * sub-amounts rather than guessing a density.
 */

export interface CanonicalUnit {
  /** The dimension bucket; amounts only ever add within one dimension. */
  dimension: 'mass' | 'volume' | 'spoon' | 'count'
  /** Multiplier to the dimension's base unit. */
  toBase: number
  /** The base unit label for this dimension. */
  base: string
}

/**
 * Spoons are their own dimension on purpose: 1 tsp and 1 tbsp are cooking units
 * a reader expects to see preserved, and converting them into ml across a list
 * would read oddly ('45 ml of cumin'). Within the spoon dimension we still
 * normalise tsp<->tbsp (1 tbsp = 3 tsp) using tsp as the base.
 */
const UNIT_MAP: Record<string, CanonicalUnit> = {
  // mass, base = gram
  g: { dimension: 'mass', toBase: 1, base: 'g' },
  gr: { dimension: 'mass', toBase: 1, base: 'g' },
  gram: { dimension: 'mass', toBase: 1, base: 'g' },
  grams: { dimension: 'mass', toBase: 1, base: 'g' },
  kg: { dimension: 'mass', toBase: 1000, base: 'g' },
  kilo: { dimension: 'mass', toBase: 1000, base: 'g' },
  kilos: { dimension: 'mass', toBase: 1000, base: 'g' },
  kilogram: { dimension: 'mass', toBase: 1000, base: 'g' },
  kilograms: { dimension: 'mass', toBase: 1000, base: 'g' },
  mg: { dimension: 'mass', toBase: 0.001, base: 'g' },
  // volume, base = millilitre
  ml: { dimension: 'volume', toBase: 1, base: 'ml' },
  milliliter: { dimension: 'volume', toBase: 1, base: 'ml' },
  millilitre: { dimension: 'volume', toBase: 1, base: 'ml' },
  cl: { dimension: 'volume', toBase: 10, base: 'ml' },
  dl: { dimension: 'volume', toBase: 100, base: 'ml' },
  l: { dimension: 'volume', toBase: 1000, base: 'ml' },
  liter: { dimension: 'volume', toBase: 1000, base: 'ml' },
  litre: { dimension: 'volume', toBase: 1000, base: 'ml' },
  liters: { dimension: 'volume', toBase: 1000, base: 'ml' },
  litres: { dimension: 'volume', toBase: 1000, base: 'ml' },
  // spoons, base = tsp
  tsp: { dimension: 'spoon', toBase: 1, base: 'tsp' },
  teaspoon: { dimension: 'spoon', toBase: 1, base: 'tsp' },
  teaspoons: { dimension: 'spoon', toBase: 1, base: 'tsp' },
  tbsp: { dimension: 'spoon', toBase: 3, base: 'tsp' },
  tablespoon: { dimension: 'spoon', toBase: 3, base: 'tsp' },
  tablespoons: { dimension: 'spoon', toBase: 3, base: 'tsp' },
  el: { dimension: 'spoon', toBase: 3, base: 'tsp' }, // Dutch eetlepel
  tl: { dimension: 'spoon', toBase: 1, base: 'tsp' }, // Dutch theelepel
}

/**
 * Count-unit synonyms that mean the same grocery unit. Maps to one canonical
 * base so "2 tenen" + "1 clove" merge. Deliberately excludes `stuk`/`stuks`:
 * a garlic bulb (stuk) is not a clove (teen) — merging them would under- or
 * over-buy (#367).
 */
const COUNT_UNIT_ALIASES: Readonly<Record<string, string>> = {
  teen: 'teen',
  tenen: 'teen',
  clove: 'teen',
  cloves: 'teen',
  stuk: 'stuk',
  stuks: 'stuk',
}

/** Cooking amounts with no reliable pack math — surface qualitatively, not "1 snuf". */
const QUALITATIVE_UNITS = new Set([
  'snuf',
  'snufje',
  'pinch',
  'naar smaak',
  'to taste',
])

/** Dutch-first display plurals where English `pluralise()` would be wrong. */
const COUNT_DISPLAY_PLURAL: Readonly<Record<string, string>> = {
  teen: 'tenen',
  stuk: 'stuks',
}

/**
 * True when the unit token is qualitative ("snuf", "pinch") — no numeric bucket.
 */
export function isQualitativeUnit(rawUnit?: string): boolean {
  return QUALITATIVE_UNITS.has(normaliseUnitToken(rawUnit))
}

/** Human label for a qualitative unit on the shopping list. */
export function qualitativeLabel(rawUnit?: string): string {
  const token = normaliseUnitToken(rawUnit)
  if (token === 'snuf') return 'snufje'
  if (token === 'pinch') return 'a pinch'
  if (token === 'naar smaak' || token === 'to taste') return 'to taste'
  if (token === 'snufje') return 'snufje'
  return token || 'to taste'
}

/**
 * Resolve a raw unit string to its canonical dimension/base. An empty or
 * unrecognised unit becomes the dimensionless `count` dimension keyed on the
 * normalised token, so 'clove' and 'cloves' add together but 'clove' and 'can'
 * stay apart.
 */
export function canonicalUnit(rawUnit?: string): CanonicalUnit {
  const token = normaliseUnitToken(rawUnit)
  if (token && UNIT_MAP[token]) return UNIT_MAP[token]
  // count dimension: alias map + singularise so unlike units never merge.
  const base = token
    ? (COUNT_UNIT_ALIASES[token] ?? singularise(token))
    : 'count'
  return { dimension: 'count', toBase: 1, base }
}

/** Lowercase, trim, strip a trailing dot ('tbsp.' -> 'tbsp'). */
export function normaliseUnitToken(rawUnit?: string): string {
  return (rawUnit ?? '').trim().toLowerCase().replace(/\.$/, '')
}

/** Naive English singularise for count units ('cloves' -> 'clove'). */
function singularise(token: string): string {
  if (token.endsWith('ies')) return token.slice(0, -3) + 'y'
  if (token.endsWith('ses')) return token.slice(0, -2)
  if (token.endsWith('s') && token.length > 1) return token.slice(0, -1)
  return token
}

/** Naive English pluralise, the inverse of `singularise` for display. */
function pluralise(token: string): string {
  if (token.endsWith('y') && token.length > 1) return token.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(token)) return token + 'es'
  return token + 's'
}

function pluraliseCount(base: string, value: number): string {
  if (value === 1) return base
  return COUNT_DISPLAY_PLURAL[base] ?? pluralise(base)
}

/**
 * Round scaled totals for display on a shopping list (#367). Internal base-unit
 * sums stay exact; only the rendered string is shopper-friendly. Counts and
 * spoons round UP (you cannot buy 0.6 stuks or half a tl); mass/volume round to
 * the nearest whole g/ml.
 */
function displayValue(
  dimension: CanonicalUnit['dimension'],
  value: number,
): number {
  if (value <= 0) return 0
  if (dimension === 'count' || dimension === 'spoon')
    return Math.ceil(value - 1e-9)
  return Math.round(value)
}

/**
 * Pick a human display unit + value for a base-unit total in a dimension.
 * Promotes to the larger unit when the number gets big (1500 g -> '1.5 kg').
 * Returns the count base verbatim (it is already the display unit).
 */
export function renderFromBase(
  dimension: CanonicalUnit['dimension'],
  baseValue: number,
  countBase: string,
): { value: number; unit: string } {
  const v = displayValue(dimension, baseValue)
  if (dimension === 'mass') {
    if (v >= 1000) return { value: round(v / 1000), unit: 'kg' }
    return { value: v, unit: 'g' }
  }
  if (dimension === 'volume') {
    if (v >= 1000) return { value: round(v / 1000), unit: 'l' }
    return { value: v, unit: 'ml' }
  }
  if (dimension === 'spoon') {
    if (v >= 3 && v % 3 === 0) return { value: v / 3, unit: 'tbsp' }
    return { value: v, unit: 'tsp' }
  }
  // count: base unit is the canonical token; no display unit when 'count'.
  if (countBase === 'count') return { value: v, unit: '' }
  return { value: v, unit: pluraliseCount(countBase, v) }
}

/** Round to 2 decimals, dropping a trailing `.0`/`.00`. */
export function round(n: number): number {
  return Math.round(n * 100) / 100
}
