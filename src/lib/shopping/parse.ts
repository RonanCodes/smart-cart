/**
 * Quantity parsing.
 *
 * Recipe quantities arrive as free-form strings. We turn them into a number
 * where we safely can, and flag the rest as `unparsed` so they surface on the
 * list without a number rather than being dropped. Supported forms:
 *
 *   '200'        -> 200
 *   '1.5'        -> 1.5
 *   '1/2'        -> 0.5            (simple fraction)
 *   '1 1/2'      -> 1.5           (mixed number)
 *   '1-2'        -> 2             (range: take the UPPER bound, per the spec)
 *   '1 to 2'     -> 2
 *   '2,5'        -> 2.5           (European decimal comma)
 *   'a pinch'    -> unparsed
 *   '' / undef   -> no number, no unparsed note (genuinely unspecified)
 */

export interface ParsedQty {
  /** The numeric value when one could be extracted, else null. */
  value: number | null
  /**
   * Set when there WAS a non-empty qty string we could not turn into a number
   * (e.g. 'a pinch'). The caller surfaces this in `unparsed`. Undefined for a
   * clean parse or a genuinely empty qty.
   */
  unparsed?: string
}

const NUMBER = String.raw`\d+(?:[.,]\d+)?`

/** A simple fraction like '1/2' or '3/4'. */
const FRACTION_RE = new RegExp(`^(\\d+)\\s*/\\s*(\\d+)$`)
/** A mixed number like '1 1/2'. */
const MIXED_RE = new RegExp(`^(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)$`)
/** A range like '1-2', '1 - 2', '1 to 2'. Captures both bounds. */
const RANGE_RE = new RegExp(`^(${NUMBER})\\s*(?:-|to|–|—)\\s*(${NUMBER})$`, 'i')
/** A plain number, possibly with a European decimal comma. */
const PLAIN_RE = new RegExp(`^(${NUMBER})$`)

function toNumber(raw: string | undefined): number {
  return Number((raw ?? '').replace(',', '.'))
}

/**
 * Parse a raw qty string into a number (or flag it unparsed).
 * Pure and total: never throws.
 */
export function parseQty(raw?: string): ParsedQty {
  const s = (raw ?? '').trim()
  if (s === '') return { value: null }

  const mixed = MIXED_RE.exec(s)
  if (mixed) {
    const whole = Number(mixed[1])
    const num = Number(mixed[2])
    const den = Number(mixed[3])
    if (den !== 0) return { value: whole + num / den }
  }

  const frac = FRACTION_RE.exec(s)
  if (frac) {
    const den = Number(frac[2])
    if (den !== 0) return { value: Number(frac[1]) / den }
  }

  const range = RANGE_RE.exec(s)
  if (range) {
    // Take the upper bound so the list never under-buys.
    return { value: Math.max(toNumber(range[1]), toNumber(range[2])) }
  }

  const plain = PLAIN_RE.exec(s)
  if (plain) return { value: toNumber(plain[1]) }

  // Non-empty but not numeric: keep it as a note ('a pinch', 'to taste').
  return { value: null, unparsed: s }
}

/**
 * Split a combined amount string into its numeric-ish head and unit tail.
 *
 * Scraped recipes (and the seeded AH / Jumbo catalogue) pack the amount AND the
 * unit into ONE field: `qty: "350 g"`, `qty: "2 el"`, `qty: "200 ml"`, with no
 * separate `unit`. The engine expects them separated (`parseQty` is numeric-only,
 * and `canonicalUnit` reads `unit`), so an unsplit "350 g" parses as an unparsed
 * note and the amount is effectively dropped from the saved list. This is the fix
 * for the "quantities often blank" bug (#238): split here, before consolidation.
 *
 * The head is everything `parseQty` can read as a number (a plain number, a
 * fraction '1/2', a mixed '1 1/2', a range '1-2', a European comma '2,5'); the
 * tail is whatever remains, trimmed, as the unit ('g', 'el', 'tsp', 'cloves').
 * A purely non-numeric string ('a pinch') yields no qty and no unit, so the
 * caller leaves it for the unparsed path. Pure and total: never throws.
 */
export function splitQtyAndUnit(raw?: string): {
  qty: string | undefined
  unit: string | undefined
} {
  const s = (raw ?? '').trim()
  if (s === '') return { qty: undefined, unit: undefined }

  // A mixed number ('1 1/2 cup') or fraction ('1/2 tsp') head, then a unit tail.
  const mixed = /^(\d+\s+\d+\s*\/\s*\d+)\s*(.*)$/.exec(s)
  if (mixed) return splitResult(mixed[1], mixed[2])
  const frac = /^(\d+\s*\/\s*\d+)\s*(.*)$/.exec(s)
  if (frac) return splitResult(frac[1], frac[2])

  // A range head ('1-2 el', '1 to 2 cloves') keeps the whole range as the qty.
  const range =
    /^(\d+(?:[.,]\d+)?\s*(?:-|to|–|—)\s*\d+(?:[.,]\d+)?)\s*(.*)$/i.exec(s)
  if (range) return splitResult(range[1], range[2])

  // A plain number head ('350 g', '2 el', '200ml', '4'), then a unit tail.
  const plain = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(s)
  if (plain) return splitResult(plain[1], plain[2])

  // No numeric head at all ('a pinch'): leave it for the unparsed path.
  return { qty: undefined, unit: undefined }
}

/** Trim both sides of a split; an empty head or unit tail becomes undefined. */
function splitResult(
  head: string | undefined,
  tail: string | undefined,
): { qty: string | undefined; unit: string | undefined } {
  const qty = (head ?? '').trim()
  const unit = (tail ?? '').trim()
  return { qty: qty || undefined, unit: unit || undefined }
}
