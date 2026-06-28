/**
 * Normalise the terse checkjebon snapshot into typed `StoreCatalogue`s.
 *
 * Two jobs:
 *  1. `parseSize` turns the free-text `s` field ("0,75 l", "ca. 700 g",
 *     "6 x 0,3 l", "200 stuks", "") into a typed quantity/unit/dimension.
 *  2. `buildCatalogues` expands every store's products: comma-decimal prices to
 *     integer cents, names to a match-friendly normalised form, sizes parsed.
 *
 * Pure: no I/O. The data is handed in (vendored JSON or a freshly synced array).
 */

import type {
  ParsedSize,
  RawProduct,
  RawStore,
  SizeDimension,
  StoreCatalogue,
  StoreCatalogues,
  StoreProduct,
} from './types'

/** Unit token -> dimension. Kept local so this layer stays self-contained. */
const UNIT_DIMENSION: Record<string, SizeDimension> = {
  g: 'mass',
  gr: 'mass',
  gram: 'mass',
  kg: 'mass',
  mg: 'mass',
  ml: 'volume',
  cl: 'volume',
  dl: 'volume',
  l: 'volume',
  liter: 'volume',
  litre: 'volume',
  stuks: 'count',
  stuk: 'count',
  st: 'count',
  stk: 'count',
  rollen: 'count',
  zakjes: 'count',
  wasbeurten: 'count',
}

/** Display-name fallbacks for the common store slugs (when `c` is absent). */
const STORE_DISPLAY: Record<string, string> = {
  ah: 'Albert Heijn',
  jumbo: 'Jumbo',
  dirk: 'Dirk',
  lidl: 'Lidl',
  aldi: 'Aldi',
  plus: 'Plus',
  dekamarkt: 'DekaMarkt',
  hoogvliet: 'Hoogvliet',
  spar: 'Spar',
  vomar: 'Vomar',
  poiesz: 'Poiesz',
  ekoplaza: 'Ekoplaza',
  coop: 'Coop',
  picnic: 'Picnic',
}

/** Parse a comma-or-dot decimal token ("0,75", "1.5", "1,234") to a number. */
function parseDecimal(token: string): number | null {
  const cleaned = token.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse the free-text pack-size string.
 *
 * Handles: empty (-> unknown), "ca." / "circa" approx prefix, comma decimals,
 * a leading "N x M unit" multiplier ("6 x 0,3 l" -> 1.8 l), and a trailing unit
 * token. Unrecognised units still return their token with dimension 'unknown'
 * when not in the table, but a recognised unit fixes the dimension.
 */
export function parseSize(raw: string | undefined): ParsedSize {
  const source = (raw ?? '').trim()
  const empty: ParsedSize = {
    raw: source,
    quantity: null,
    unit: null,
    dimension: 'unknown',
    approx: false,
  }
  if (!source) return empty

  let work = source.toLowerCase()
  const approx = /\bca\.?\b|\bcirca\b/.test(work)
  // Strip a leading "ca." / "circa" circa-prefix (the trailing dot too).
  work = work.replace(/\bca\.?|\bcirca\b/g, '').trim()

  // Optional leading "N x" multiplier: "6 x 0,3 l", "2x500 g".
  let multiplier = 1
  const multMatch = work.match(/^(\d+(?:[.,]\d+)?)\s*x\s*/)
  if (multMatch) {
    const m = parseDecimal(multMatch[1]!)
    if (m !== null && m > 0) {
      multiplier = m
      work = work.slice(multMatch[0].length).trim()
    }
  }

  // "<number> <unit>" where unit is a word. Number may be comma-decimal.
  const match = work.match(/^(\d+(?:[.,]\d+)?)\s*([a-zµ.]+)?/i)
  if (!match) return { ...empty, approx }

  const value = parseDecimal(match[1]!)
  if (value === null) return { ...empty, approx }

  const unitToken = (match[2] ?? '').replace(/\.$/, '').trim()
  const unit = unitToken || null
  const dimension: SizeDimension =
    unit && UNIT_DIMENSION[unit] ? UNIT_DIMENSION[unit] : 'unknown'

  return {
    raw: source,
    quantity: round2(value * multiplier),
    unit,
    dimension,
    approx,
  }
}

/**
 * Normalise a product / ingredient name for matching: lower-case, strip accents,
 * drop punctuation, collapse whitespace. Keeps digits (sizes embedded in names
 * help disambiguate) but trims them to single spaces.
 */
export function normaliseName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip combining accents
      .replace(/[^a-z0-9\s]/g, ' ')
      // split a digit glued to a unit ("500g" -> "500 g") so the matcher can drop
      // the quantity token cleanly.
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** Normalise a shopping-list amount for cache keys (lower-case, collapsed spaces). */
export function normaliseAmount(amount: string | null | undefined): string {
  return (amount ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Euros (possibly float) to integer cents, guarding NaN/negative. */
export function eurosToCents(price: number | undefined): number | null {
  if (price === undefined || !Number.isFinite(price) || price < 0) return null
  return Math.round(price * 100)
}

function normaliseProduct(store: string, raw: RawProduct): StoreProduct | null {
  const name = (raw.n ?? '').trim()
  if (!name) return null
  const priceCents = eurosToCents(raw.p)
  if (priceCents === null) return null // drop priceless rows; never invent a price
  return {
    store,
    name,
    normalisedName: normaliseName(name),
    priceCents,
    slug: raw.l ?? null,
    size: parseSize(raw.s),
  }
}

/**
 * Build the keyed `StoreCatalogues` from the raw snapshot. Stores with zero
 * usable products are still represented (empty `products`) so coverage stays
 * honest: a caller can tell "store covered but no match" from "store absent".
 */
export function buildCatalogues(raw: Array<RawStore>): StoreCatalogues {
  const out: StoreCatalogues = {}
  for (const store of raw) {
    const slug = (store.n ?? '').trim().toLowerCase()
    if (!slug) continue
    const products: Array<StoreProduct> = []
    for (const p of store.d ?? []) {
      const normalised = normaliseProduct(slug, p)
      if (normalised) products.push(normalised)
    }
    const catalogue: StoreCatalogue = {
      store: slug,
      displayName: store.c ?? STORE_DISPLAY[slug] ?? slug,
      urlBase: store.u ?? null,
      products,
    }
    out[slug] = catalogue
  }
  return out
}

/** Round to 2 decimals (kills float noise from comma-decimal multiplication). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
