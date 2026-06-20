/**
 * Pure mapping: a swap / similar PICK -> a recommender data point.
 *
 * When the user accepts a swap on the week view (either one of the day's ~5 ready
 * alternatives, #123, or a specific "similar" neighbour, #31) they have told us
 * something about their taste: they actively chose this recipe over what was there.
 * The recommender already infers taste from `recipe_swipe` rows (onboarding likes /
 * dislikes) and folds post-meal `meal_feedback` on top; both reduce to the same
 * `{ recipeId, like }` shape (see recsys/feedback-fold). So the cleanest data point
 * we can emit for a pick is a `recipe_swipe` LIKE row for the chosen recipe, scoped
 * to the household. No new table, no new signal type: it flows straight into the
 * planner / replan / week swipe query, which only filters on `direction`.
 *
 * Pure: no DB, no Worker bindings. The server fn (swap-server.ts) computes the rows
 * here, then inserts only the ones that are not already present (idempotency), so a
 * user picking the same recipe twice does not double-count.
 *
 * Soft-negative for the REPLACED recipe: deliberately NOT emitted here. A swap is
 * often variety-seeking ("not pasta again this week"), not a dislike, so writing a
 * `dislike` for the recipe swapped away would poison the taste model with noise.
 * Left as a follow-up; if we later want it, gate it behind a separate, explicit
 * "I disliked this" affordance, not an implicit swap-away.
 */

/** The round marker we stamp on swap-derived swipes so they are distinguishable
 * from onboarding (round 0) and the analytics that count onboarding rounds, while
 * still being consumed by the recommender (which only reads `direction`). */
export const SWAP_SWIPE_ROUND = -1

/** A swipe row the recommender already consumes, narrowed to what we write. */
export interface PickSwipeRow {
  householdId: string
  recipeId: string
  /** Always 'like' here: a pick is a positive signal. */
  direction: 'like'
  /** Marks this as swap-derived, not onboarding. */
  round: number
}

/** The pick we are recording, narrowed to what the data point needs. */
export interface SwapPick {
  householdId: string
  /** The recipe the user picked (the chosen alternative / neighbour). */
  chosenRecipeId: string
}

/**
 * Map a pick to the recommender data point(s) it should produce.
 *
 * Returns the LIKE row for the chosen recipe. Returns an empty array when the input
 * is incomplete (no household or no chosen recipe), so the caller can write the
 * result unconditionally without guarding each field. The caller is responsible for
 * idempotency (skip rows whose (householdId, recipeId, direction='like') already
 * exists from the swap path).
 */
export function pickToSwipeRows(pick: SwapPick): Array<PickSwipeRow> {
  if (!pick.householdId || !pick.chosenRecipeId) return []
  return [
    {
      householdId: pick.householdId,
      recipeId: pick.chosenRecipeId,
      direction: 'like',
      round: SWAP_SWIPE_ROUND,
    },
  ]
}

/**
 * The minimal recipe_swipe persistence surface this recorder needs. Keeping it to
 * a port (rather than the whole drizzle db) lets the recorder be unit-tested with a
 * mock and keeps the idempotency + write logic out of the server fn body.
 */
export interface SwipeStore {
  /** True when a row for (householdId, recipeId, direction) already exists. */
  hasSwipe: (row: {
    householdId: string
    recipeId: string
    direction: 'like'
  }) => Promise<boolean>
  /** Insert one swipe row. The id is minted by the caller of `insertSwipe`. */
  insertSwipe: (row: PickSwipeRow & { id: string }) => Promise<void>
}

/** Result of a recording attempt, for logging / assertions. */
export interface RecordResult {
  /** Rows actually inserted (after the idempotency skip). */
  inserted: number
  /** Rows skipped because an equivalent swipe already existed. */
  skipped: number
}

/**
 * Record a pick's data point(s) into the swipe store, idempotently.
 *
 * For each row `pickToSwipeRows` produces, insert it only when no equivalent swipe
 * exists yet (same household + recipe + direction). `newId` mints the row id (the
 * server passes `crypto.randomUUID`); injecting it keeps this pure-testable. This
 * does NOT swallow errors — the server fn wraps the call in try/catch so a failure
 * here never breaks the swap.
 */
export async function recordPickDataPoint(
  store: SwipeStore,
  pick: SwapPick,
  newId: () => string,
): Promise<RecordResult> {
  let inserted = 0
  let skipped = 0
  for (const row of pickToSwipeRows(pick)) {
    const exists = await store.hasSwipe({
      householdId: row.householdId,
      recipeId: row.recipeId,
      direction: row.direction,
    })
    if (exists) {
      skipped += 1
      continue
    }
    await store.insertSwipe({ ...row, id: newId() })
    inserted += 1
  }
  return { inserted, skipped }
}
