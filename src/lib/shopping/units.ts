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
 * Resolve a raw unit string to its canonical dimension/base. An empty or
 * unrecognised unit becomes the dimensionless `count` dimension keyed on the
 * normalised token, so 'clove' and 'cloves' add together but 'clove' and 'can'
 * stay apart.
 */
export function canonicalUnit(rawUnit?: string): CanonicalUnit {
  const token = normaliseUnitToken(rawUnit)
  if (token && UNIT_MAP[token]) return UNIT_MAP[token]
  // count dimension: the (singularised) token IS the base so unlike loose
  // units never merge. Empty unit => the universal 'count' bucket.
  const base = token ? singularise(token) : 'count'
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
  if (dimension === 'mass') {
    if (baseValue >= 1000) return { value: round(baseValue / 1000), unit: 'kg' }
    return { value: round(baseValue), unit: 'g' }
  }
  if (dimension === 'volume') {
    if (baseValue >= 1000) return { value: round(baseValue / 1000), unit: 'l' }
    return { value: round(baseValue), unit: 'ml' }
  }
  if (dimension === 'spoon') {
    if (baseValue >= 3 && baseValue % 3 === 0)
      return { value: round(baseValue / 3), unit: 'tbsp' }
    return { value: round(baseValue), unit: 'tsp' }
  }
  // count: base unit is the (singularised) token; no display unit when 'count'.
  if (countBase === 'count') return { value: round(baseValue), unit: '' }
  const value = round(baseValue)
  return { value, unit: value === 1 ? countBase : pluralise(countBase) }
}

/** Round to 2 decimals, dropping a trailing `.0`/`.00`. */
export function round(n: number): number {
  return Math.round(n * 100) / 100
}
