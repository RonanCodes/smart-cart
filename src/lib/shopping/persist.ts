/**
 * Pure helpers for the PERSISTED shopping list (slice #146).
 *
 * The engine in `consolidate.ts` derives a fresh consolidated list from the
 * week every time it runs; nothing about it survives an edit. This module is
 * the seam for the persisted layer: turning the derived lines into rows the
 * household saves, and merging a new week's lines into a list that may already
 * hold rows (recipe lines from a previous "add to list", staples, and manual
 * adds the user typed in).
 *
 * Everything here is PURE: no DB, no I/O, no clock, no randomness. The
 * server fns in `shopping-list-server.ts` wrap a D1 query around these.
 */

import type { ShoppingLine } from './types'

/** Where a saved line came from. Drives the small context label in the UI. */
export type ShoppingItemSource = 'recipe' | 'staple' | 'manual'

/**
 * One persisted shopping-list item, mirroring the `shopping_list_item` row but
 * without the household scoping (which the server owns). `amount` is the
 * free-text amount string ('450 g', '2 + 15 g', 'a pinch'), null when the user
 * never gave one. `checked` is the ticked-off state.
 */
export interface ShoppingItem {
  id: string
  name: string
  amount: string | null
  unit: string | null
  checked: boolean
  source: ShoppingItemSource
  createdAt: number
}

/**
 * A line ready to be inserted as a row: the derived fields the merge produced,
 * before the server stamps on the id, household, and createdAt. `amount` is
 * already the human display string from the engine.
 */
export interface NewShoppingItem {
  name: string
  amount: string | null
  unit: string | null
  source: ShoppingItemSource
}

/**
 * Normalise an item name for de-dupe: trimmed, lower-cased, inner whitespace
 * collapsed. 'Onion', 'onion ', and '  ONION' all collapse to 'onion' so adding
 * the week twice merges rather than duplicating. Kept local (not imported from
 * pricing) so the merge stays unit-testable without the catalogue layer.
 */
export function normaliseItemName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Turn one engine line into the persisted shape. The engine's `displayAmount`
 * is the source of the human amount; an empty / '(unspecified amount)' display
 * persists as null so the row simply shows no amount rather than noise.
 */
export function lineToNewItem(line: ShoppingLine): NewShoppingItem {
  const amount =
    line.displayAmount && line.displayAmount !== '(unspecified amount)'
      ? line.displayAmount
      : null
  return {
    name: line.name.trim(),
    amount,
    unit: line.unit ?? null,
    source: 'recipe',
  }
}

/**
 * Should the Shopping tab auto-seed its editable list from the week on load?
 *
 * The page is the clean editable list by default: when the household has a
 * planned week (a non-null plan id) but has not saved any rows yet, we seed the
 * list from that week so the user lands on the real list instead of a read-only
 * preview, with no dead "Add to shopping list" tap required. Once any row
 * exists (a recipe seed, a staple, or a manual add) we never re-seed, so a
 * user who cleared the list is not fought by the page re-filling it. The seed
 * itself is idempotent on the server (planMerge dedupes), so this guard is
 * about intent, not correctness.
 *
 * `clearedByUser` is the deliberate-empty signal: an empty list reached by
 * tapping "Clear all" is a CHOICE, not a never-seeded state, so we must not
 * immediately re-fill it. Clearing to empty stays cleared until the user adds
 * something back. Without this flag, "Clear all" on a planned week would race
 * the loader into re-seeding the very rows the user just wiped.
 */
export function shouldAutoSeed(input: {
  planId: string | null
  savedItemCount: number
  clearedByUser?: boolean
}): boolean {
  if (input.clearedByUser) return false
  return input.planId !== null && input.savedItemCount === 0
}

/**
 * Try to sum two amount strings that share a single trailing unit, e.g.
 * '450 g' + '200 g' => '650 g', '2' + '3' => '5'. Returns null when either side
 * is compound ('2 + 15 g'), carries unparsed notes, or the units differ, in
 * which case the caller falls back to concatenation. Deliberately conservative:
 * a wrong sum is worse than an honest '450 g + 200 g'.
 */
export function sumAmounts(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a

  const pa = parseSingleAmount(a)
  const pb = parseSingleAmount(b)
  if (!pa || !pb) return null
  if (pa.unit !== pb.unit) return null

  const total = round1(pa.value + pb.value)
  return pa.unit ? `${total} ${pa.unit}` : `${total}`
}

interface SingleAmount {
  value: number
  /** Empty string = unitless (a bare count). */
  unit: string
}

/**
 * Parse a SINGLE simple amount ('450 g', '2', '1.5 l'). Returns null for
 * anything compound or non-numeric ('2 + 15 g', 'a pinch', '450 g (to taste)').
 */
function parseSingleAmount(s: string): SingleAmount | null {
  const trimmed = s.trim()
  // A compound or annotated amount is not summable.
  if (trimmed.includes('+') || trimmed.includes('(')) return null
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(trimmed)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  return { value, unit: m[2] ?? '' }
}

/** Round to one decimal, dropping a trailing '.0'. Mirrors the engine. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Join two amounts that could not be summed, skipping empties. */
export function concatAmounts(
  a: string | null,
  b: string | null,
): string | null {
  if (a === null) return b
  if (b === null) return a
  if (a === b) return a
  return `${a} + ${b}`
}

/**
 * Merge a batch of new recipe lines INTO an existing list, de-duping by
 * normalised name. The result is the set of operations the server applies:
 *
 *  - `inserts`: lines whose name is not already present, ready to be inserted.
 *  - `updates`: existing rows whose amount should change because a matching new
 *    line added to it (summed where the units line up, else concatenated).
 *
 * An incoming line that matches an existing row by name folds its amount into
 * that row rather than adding a second row, so "add the week to my list" twice
 * does not double everything. Manual / staple rows are matched too: adding a
 * recipe's onion onto a manually-typed 'onion' merges sensibly.
 *
 * Pure: it computes the diff; it does not touch the DB.
 */
export interface MergePlan {
  inserts: Array<NewShoppingItem>
  updates: Array<{ id: string; amount: string | null }>
}

export function planMerge(
  existing: Array<ShoppingItem>,
  incoming: Array<NewShoppingItem>,
): MergePlan {
  const byName = new Map<string, ShoppingItem>()
  for (const item of existing) byName.set(normaliseItemName(item.name), item)

  const inserts: Array<NewShoppingItem> = []
  // Track amount state for rows we touch so two incoming lines for the same
  // existing row accumulate correctly across the batch.
  const updatedAmounts = new Map<string, string | null>()

  for (const line of incoming) {
    const key = normaliseItemName(line.name)
    const match = byName.get(key)

    if (!match) {
      // Could also collide with another incoming line earlier in this batch.
      const pending = inserts.find((i) => normaliseItemName(i.name) === key)
      if (pending) {
        pending.amount = mergeAmount(pending.amount, line.amount)
        pending.unit = pending.unit ?? line.unit
      } else {
        inserts.push({ ...line })
      }
      continue
    }

    const current = updatedAmounts.has(match.id)
      ? (updatedAmounts.get(match.id) ?? null)
      : match.amount
    updatedAmounts.set(match.id, mergeAmount(current, line.amount))
  }

  const updates = [...updatedAmounts.entries()].map(([id, amount]) => ({
    id,
    amount,
  }))

  return { inserts, updates }
}

/** Sum when possible, else concatenate. The amount-merge policy in one place. */
export function mergeAmount(a: string | null, b: string | null): string | null {
  const summed = sumAmounts(a, b)
  return summed !== null ? summed : concatAmounts(a, b)
}

/**
 * How many incoming lines are genuinely NEW relative to the existing list.
 * That is exactly `planMerge(...).inserts.length`: a line that folds its amount
 * into an existing row is not "missing", it is already represented. The week
 * CTA uses this to decide between "All added" (0) and "Add N item(s)" (N>0).
 */
export function countMissing(
  existing: Array<ShoppingItem>,
  incoming: Array<NewShoppingItem>,
): number {
  return planMerge(existing, incoming).inserts.length
}

/**
 * The label + disabled state for the week's "Add to shopping list" CTA, given
 * how many week ingredients are not yet on the saved list.
 *
 *  - 0 missing  -> disabled, "All added" (nothing to do; everything is there).
 *  - 1 missing  -> "Add 1 item to shopping list" (singular).
 *  - N missing  -> "Add N items to shopping list" (plural).
 *
 * Pure and string-only so the visual states are unit-tested without React.
 */
export function addToListCta(missingCount: number): {
  label: string
  disabled: boolean
} {
  if (missingCount <= 0) return { label: 'All added', disabled: true }
  const noun = missingCount === 1 ? 'item' : 'items'
  return {
    label: `Add ${missingCount} ${noun} to shopping list`,
    disabled: false,
  }
}
