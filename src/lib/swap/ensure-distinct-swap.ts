/**
 * Guarantee a swap lands on a DIFFERENT recipe than the day already shows (#256).
 *
 * Tapping Swap (or picking an alternative) must always move the day to a recipe
 * the day is not already on. The candidate lists are normally distinct already
 * (the similar list drops the query recipe, the per-day alternatives exclude the
 * current pick), but a stale list, a duplicated id, or a degenerate catalogue can
 * still send the day's own recipe back. This pure resolver is the last gate: given
 * the recipe the request chose and the day's current recipe, it returns the chosen
 * recipe when it is genuinely different, otherwise the next-best DISTINCT candidate
 * from the ranked pool, and only returns the current recipe again when there is no
 * other recipe available at all (a real degenerate, not a bug).
 *
 * Pure: no DB, no Worker bindings. The server fn (swap-server.ts) loads the rows,
 * builds the ranked pool, calls this, then persists.
 */

export interface DistinctSwapInput {
  /** The recipe id the request picked (a similar neighbour or an alternative). */
  chosenId: string
  /** The day's current recipe id (the dish we must move away from). Empty = none. */
  currentRecipeId: string
  /**
   * Ranked candidate recipe ids for this day, best first, already store-filtered
   * and taste-ranked (e.g. topNForDay output). Used only as the fallback pool when
   * the chosen recipe collides with the current one; the chosen recipe itself does
   * not need to appear here.
   */
  rankedCandidateIds: ReadonlyArray<string>
  /**
   * Other recipe ids the swap should avoid so it does not duplicate another day
   * (every other day's current pick). The current day's recipe is handled
   * separately via `currentRecipeId`. Optional.
   */
  avoidIds?: ReadonlyArray<string>
}

export interface DistinctSwapResult {
  /** The recipe id to write into the day, distinct from the current one when possible. */
  recipeId: string
  /**
   * True when no distinct recipe was available, so the day keeps its current
   * recipe. The server treats this as "no change" rather than persisting a no-op
   * swap. Only set in the genuine degenerate case (a one-recipe catalogue, or every
   * other recipe already placed in the week).
   */
  degenerate: boolean
}

/**
 * Resolve the recipe a swap should write so it is never the day's current dish.
 *
 * Order:
 *  1. If the chosen recipe differs from the current one, keep it (the common path,
 *     no behaviour change for a normal pick).
 *  2. Otherwise walk the ranked pool for the first candidate that is neither the
 *     current recipe nor in `avoidIds`, and return that (the next-best distinct
 *     fallback, honouring the same store filter + taste ranking the pool carries).
 *  3. If the pool yields nothing distinct, return the current recipe and flag it
 *     degenerate so the caller can treat it as a no-op (genuinely nothing else to
 *     swap in).
 */
export function ensureDistinctSwap(
  input: DistinctSwapInput,
): DistinctSwapResult {
  const { chosenId, currentRecipeId, rankedCandidateIds } = input
  const avoid = new Set(input.avoidIds ?? [])

  // 1. The chosen recipe is already different: keep the existing behaviour.
  if (chosenId && chosenId !== currentRecipeId) {
    return { recipeId: chosenId, degenerate: false }
  }

  // 2. The chosen recipe collides with the current pick (or was empty). Fall back
  // to the next-best DISTINCT candidate from the ranked pool.
  for (const id of rankedCandidateIds) {
    if (!id) continue
    if (id === currentRecipeId) continue
    if (avoid.has(id)) continue
    return { recipeId: id, degenerate: false }
  }

  // 3. Nothing distinct to swap in. Keep the current recipe and flag it so the
  // server persists no no-op revision.
  return { recipeId: currentRecipeId, degenerate: true }
}
