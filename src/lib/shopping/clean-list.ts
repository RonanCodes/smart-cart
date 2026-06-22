/**
 * Conservative noise filter + de-dupe for the consolidated shopping list (#cart-clean).
 *
 * LLM-generated recipe ingredient lists leak rows that are not groceries you buy:
 *  - "from the tap" cooking water ("tap water 1200 ml", "boiling water 900 ml"),
 *  - zero / blank amounts that read as junk ("chili flakes 0 tsp"),
 *  - near-duplicate spelling variants that should be one row
 *    ("chili flakes" + "chilli flakes" => one "chilli flakes").
 *
 * This module is the single, conservative pass that keeps that noise out of the
 * cart. It is deliberately cautious: it only drops rows it is confident are not
 * real groceries, and it only merges names that normalise to the same thing once
 * a small spelling-variant map is applied. A wrong drop (losing a real grocery)
 * is worse than letting one odd row through, so the rules stay tight.
 *
 * Everything here is PURE: no DB, no I/O, no React. Unit-tested in
 * clean-list.test.ts. Reused by `consolidate` (at source) and by the editable
 * list component (to clean rows already persisted before this shipped).
 */

import { normaliseItemName, mergeAmount } from './persist'

/**
 * Spelling / variant map applied ON TOP of `normaliseItemName` to build the
 * de-dupe key. Both spellings collapse to one canonical token so the two rows
 * merge into a single line. Keep this list small and high-confidence: only
 * variants that are genuinely the same product. Keyed and valued on the
 * already-normalised (lower-case, single-spaced) form.
 */
const SPELLING_VARIANTS: Readonly<Record<string, string>> = {
  chili: 'chilli',
  chilis: 'chilli',
  chilies: 'chilli',
  chillies: 'chilli',
  yoghurt: 'yogurt',
  yoghurts: 'yogurt',
  yogurts: 'yogurt',
  courgettes: 'courgette',
  aubergines: 'aubergine',
  chickpeas: 'chickpea',
}

/**
 * The de-dupe key for a name: normalise it, then map each word through the
 * spelling-variant table so "chili flakes" and "chilli flakes" land on the same
 * key. Word-by-word so a variant anywhere in a multi-word name is caught.
 */
export function dedupeKey(name: string): string {
  const normalised = normaliseItemName(name)
  if (normalised === '') return ''
  return normalised
    .split(' ')
    .map((word) => SPELLING_VARIANTS[word] ?? word)
    .join(' ')
}

/**
 * Names (after normalisation) that are cooking water "from the tap", not a
 * grocery you put in a basket. Matched as a whole phrase OR as the bare word
 * "water" so "water", "tap water", "boiling water", "hot/cold/ice water",
 * "water (for boiling)" all drop. Bottled / flavoured waters are NOT in here on
 * purpose (e.g. "sparkling water", "coconut water") — those are real buys, and
 * the match below requires the name to be EXACTLY water-ish, not merely contain
 * the word.
 */
const NON_GROCERY_WATER = new Set([
  'water',
  'tap water',
  'boiling water',
  'boiled water',
  'hot water',
  'warm water',
  'cold water',
  'ice water',
  'iced water',
  'cool water',
  'lukewarm water',
  'filtered water',
  'fresh water',
  'running water',
  'drinking water',
])

/**
 * True when a name is cooking water that should never reach the cart. Strips a
 * trailing parenthetical note first ("water (for the pasta)" => "water") so an
 * annotated tap-water line still matches. Conservative: only the exact phrases
 * above count, so "sparkling water" or "coconut water" (real groceries) survive.
 */
export function isNonGroceryWater(name: string): boolean {
  const base = normaliseItemName(name)
    .replace(/\(.*\)/g, '')
    .trim()
  return NON_GROCERY_WATER.has(base)
}

/**
 * True when an amount string is a "zero amount" — "0", "0 tsp", "0 g", "0.0 ml",
 * "0,0 g" — i.e. a quantity of nothing. Such an amount is noise: it should not be
 * shown. Blank / null amounts are NOT zero amounts (a real grocery can simply
 * have no amount yet); they return false so the row keeps its blank "+" slot.
 */
export function isZeroAmount(amount: string | null | undefined): boolean {
  if (amount == null) return false
  const trimmed = amount.trim()
  if (trimmed === '') return false
  // A leading numeric token of zero, optionally followed by a unit. Accept both
  // '.' and ',' decimals (Dutch). '0', '0 g', '0.0 tsp', '0,00 ml'.
  return /^0(?:[.,]0+)?(\s+[a-zA-Z]+)?$/.test(trimmed)
}

/** The minimal row shape the cleaner operates on. */
export interface CleanableRow {
  name: string
  amount: string | null
}

/**
 * Clean + de-dupe a list of rows, preserving input order and every field on the
 * FIRST-seen row of each de-dupe group (id, checked, source, ...). The pass:
 *
 *  1. Drops cooking-water rows ("tap water", "boiling water", ...).
 *  2. Blanks a zero amount ("0 tsp" => null) so the row reads as a clean name
 *     with no junk quantity, rather than dropping a possibly-real grocery.
 *  3. Merges rows whose names share a de-dupe key (spelling variants included)
 *     into the first one, summing amounts where the units line up, else
 *     concatenating (the same amount-merge policy as `planMerge`).
 *
 * Generic over the row type so it cleans both engine lines and persisted
 * `ShoppingItem`s. The caller supplies how to read and write `name`/`amount`.
 */
export function cleanRows<T extends CleanableRow>(
  rows: ReadonlyArray<T>,
): Array<T> {
  const out: Array<T> = []
  const indexByKey = new Map<string, number>()

  for (const row of rows) {
    if (isNonGroceryWater(row.name)) continue

    // A zero amount is noise: keep the row (it may be a real grocery) but drop
    // the meaningless quantity so it never renders as "0 tsp".
    const amount = isZeroAmount(row.amount) ? null : row.amount

    const key = dedupeKey(row.name)
    if (key === '') continue

    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      out.push({ ...row, amount })
      indexByKey.set(key, out.length - 1)
      continue
    }

    // Fold this row's amount into the first row with the same key.
    const first = out[existingIndex]!
    out[existingIndex] = {
      ...first,
      amount: mergeAmount(first.amount, amount),
    }
  }

  return out
}
