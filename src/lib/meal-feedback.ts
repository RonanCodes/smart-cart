/**
 * Pure shaping for post-meal feedback (#126).
 *
 * The week view lets a household rate a dinner they actually cooked: thumbs up,
 * thumbs down, or just a free note ("not pizza every week"). A thumb maps to a
 * `meal_feedback` row whose `rating` column is exactly the string the recommender
 * folds in (`'up'` | `'down'`, see recsys/feedback-fold.ts `mealFeedbackToSwipe`).
 *
 * A note is its own signal: a household can leave a note with no thumb at all, so
 * a row is written whenever there is a thumb OR a note. Only when both are empty
 * does the feedback carry nothing, in which case it produces no row (the caller
 * deletes any existing one instead). A note-only row stores `rating` as null.
 *
 * This module is pure (no DB, no Worker deps) so the mapping runs identically in
 * the unit tests and inside the server fn.
 */

/** What the user can express on a planned dinner. `null` = cleared / no opinion. */
export type MealRating = 'up' | 'down' | null

/**
 * The subset of a `meal_feedback` row this UI owns. `id`, `householdId`, and
 * `createdAt` are filled in by the server fn (it knows the household and whether
 * a row already exists); the mapping only decides the signal-bearing columns.
 */
export interface MealFeedbackRowInput {
  recipeId: string
  mealPlanId: string
  /** A thumb, or null for a note-only row (a note is feedback on its own). */
  rating: 'up' | 'down' | null
  /** Trimmed free note, or null when the user left it blank. */
  note: string | null
}

/** A blank/whitespace note is stored as null, never as an empty string. */
export function normaliseNote(note: string | null | undefined): string | null {
  if (note == null) return null
  const trimmed = note.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Map a UI rating + note to the row the server should write, or `null` when the
 * feedback is empty (no thumb AND no note), in which case no row is written and
 * any existing one is removed instead.
 *
 * A note is feedback on its own: a note with no thumb still writes a row (rating
 * null). When a thumb is present, the `rating` it returns is the literal the
 * recommender expects, so the row folds straight into next week's taste with no
 * extra translation.
 */
export function ratingToFeedbackRow(input: {
  recipeId: string
  mealPlanId: string
  rating: MealRating
  note?: string | null
}): MealFeedbackRowInput | null {
  const rating =
    input.rating === 'up' || input.rating === 'down' ? input.rating : null
  const note = normaliseNote(input.note)
  // Empty feedback (no thumb and no note) carries no signal: no row.
  if (rating === null && note === null) return null
  return {
    recipeId: input.recipeId,
    mealPlanId: input.mealPlanId,
    rating,
    note,
  }
}

/**
 * What the server fn should do to the meal_feedback table, decided purely from
 * the mapped row and whether a row already exists for this (household, recipe,
 * plan). Pulled out so the upsert/clear branching is unit-testable without the
 * Start server runtime.
 *
 *   - `insert`  : fresh feedback (a thumb and/or a note), no prior row.
 *   - `update`  : re-rating or re-noting an existing dinner (one row per key).
 *   - `delete`  : emptied feedback (no thumb, no note) with a prior row to remove.
 *   - `noop`    : emptied feedback and nothing was there.
 */
export type FeedbackWriteAction =
  | { kind: 'insert'; row: MealFeedbackRowInput }
  | { kind: 'update'; id: string; row: MealFeedbackRowInput }
  | { kind: 'delete'; id: string }
  | { kind: 'noop' }

export function planFeedbackWrite(
  existingId: string | null,
  row: MealFeedbackRowInput | null,
): FeedbackWriteAction {
  if (!row) {
    return existingId ? { kind: 'delete', id: existingId } : { kind: 'noop' }
  }
  return existingId
    ? { kind: 'update', id: existingId, row }
    : { kind: 'insert', row }
}
