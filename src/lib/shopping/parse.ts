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
