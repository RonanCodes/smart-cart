/**
 * Pure shaping for post-meal feedback (#126).
 *
 * The week view lets a household rate a dinner they actually cooked: thumbs up,
 * thumbs down, or clear (no opinion). That UI rating maps to a `meal_feedback`
 * row whose `rating` column is exactly the string the recommender folds in
 * (`'up'` | `'down'`, see recsys/feedback-fold.ts `mealFeedbackToSwipe`). A
 * cleared rating carries no signal, so it produces no row (the caller deletes
 * any existing one instead).
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
  rating: 'up' | 'down'
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
 * rating is cleared (no row, the existing one is removed instead).
 *
 * The `rating` it returns is the literal the recommender expects, so a written
 * row folds straight into next week's taste with no extra translation.
 */
export function ratingToFeedbackRow(input: {
  recipeId: string
  mealPlanId: string
  rating: MealRating
  note?: string | null
}): MealFeedbackRowInput | null {
  if (input.rating !== 'up' && input.rating !== 'down') return null
  return {
    recipeId: input.recipeId,
    mealPlanId: input.mealPlanId,
    rating: input.rating,
    note: normaliseNote(input.note),
  }
}

/**
 * What the server fn should do to the meal_feedback table, decided purely from
 * the mapped row and whether a row already exists for this (household, recipe,
 * plan). Pulled out so the upsert/clear branching is unit-testable without the
 * Start server runtime.
 *
 *   - `insert`  : a fresh rating, no prior row.
 *   - `update`  : re-rating an existing dinner (idempotent — one row per key).
 *   - `delete`  : cleared rating with a prior row to remove.
 *   - `noop`    : cleared rating and nothing was there.
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
