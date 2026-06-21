import { createServerFn } from '@tanstack/react-start'
import { planFeedbackWrite, ratingToFeedbackRow } from './meal-feedback'
import type { FeedbackWriteAction, MealRating } from './meal-feedback'

export interface SubmitMealFeedbackRequest {
  /** The week (meal_plan) the rated dinner belongs to. */
  planId: string
  /** The rated recipe (the day's current dinner). */
  recipeId: string
  /** Thumbs up, thumbs down, or null to clear an earlier rating. */
  rating: MealRating
  /** Optional short note ("not pizza every week"). Blank is stored as null. */
  note?: string | null
}

export interface MealFeedbackState {
  recipeId: string
  /** A thumb, or null for a note-only feedback (a note is feedback on its own). */
  rating: 'up' | 'down' | null
  note: string | null
}

/**
 * The `meal_feedback.rating` column is `NOT NULL` text, so a note-only row (which
 * has no thumb) stores the empty string as its sentinel. The recommender's
 * `mealFeedbackToSwipe` already ignores anything that is not 'up'/'down', so an
 * empty rating contributes no taste signal — exactly right for a note alone.
 * These two helpers translate at the DB boundary; everything above the boundary
 * speaks `'up' | 'down' | null`.
 */
export function ratingToColumn(rating: 'up' | 'down' | null): string {
  return rating ?? ''
}
export function ratingFromColumn(rating: string | null): 'up' | 'down' | null {
  return rating === 'up' || rating === 'down' ? rating : null
}

/**
 * The slice of the drizzle db / schema table that the write needs. Kept
 * structural (not the real drizzle types) so this module imports nothing
 * server-only at the top level and the write stays mockable in tests.
 */
type WhereChain = { where: (cond: unknown) => Promise<unknown> }
export interface MealFeedbackDb {
  insert: (table: unknown) => { values: (row: unknown) => Promise<unknown> }
  update: (table: unknown) => { set: (set: unknown) => WhereChain }
  delete: (table: unknown) => WhereChain
}
export interface MealFeedbackTable {
  id: unknown
}

/**
 * Carry out the chosen feedback write against `meal_feedback`, translating the
 * nullable UI rating to the NOT NULL column at the boundary. Pulled out of the
 * server-fn handler so the actual insert/update/delete can be unit-tested with a
 * mock db (the schema table + drizzle `eq` are injected, so this module still
 * imports nothing server-only at the top level — the client-bundle rule holds).
 *
 * A note-only action (rating null) still inserts/updates a row: a note is feedback
 * on its own. Only an emptied feedback (delete/noop) removes the row.
 */
export async function applyFeedbackWrite(args: {
  db: MealFeedbackDb
  table: MealFeedbackTable
  eq: (a: unknown, b: unknown) => unknown
  householdId: string
  action: FeedbackWriteAction
  now?: Date
}): Promise<void> {
  const { db, table, eq, householdId, action } = args
  const now = args.now ?? new Date()
  switch (action.kind) {
    case 'delete':
      await db.delete(table).where(eq(table.id, action.id))
      return
    case 'noop':
      return
    case 'update':
      await db
        .update(table)
        .set({
          rating: ratingToColumn(action.row.rating),
          note: action.row.note,
          createdAt: now,
        })
        .where(eq(table.id, action.id))
      return
    case 'insert':
      await db.insert(table).values({
        id: crypto.randomUUID(),
        householdId,
        mealPlanId: action.row.mealPlanId,
        recipeId: action.row.recipeId,
        rating: ratingToColumn(action.row.rating),
        note: action.row.note,
        createdAt: now,
      })
      return
  }
}

/**
 * Map raw `meal_feedback` rows to the UI feedback states for rehydrate. Keeps
 * every row scoped to a recipe — including note-only rows (rating '') — so a saved
 * note shows again on reload even when the household left no thumb.
 */
export function mapFeedbackRows(
  rows: Array<{
    recipeId: string | null
    rating: string | null
    note: string | null
  }>,
): Array<MealFeedbackState> {
  return rows
    .filter(
      (
        r,
      ): r is {
        recipeId: string
        rating: string | null
        note: string | null
      } => Boolean(r.recipeId),
    )
    .map((r) => ({
      recipeId: r.recipeId,
      rating: ratingFromColumn(r.rating),
      note: r.note,
    }))
}

export interface SubmitMealFeedbackResponse {
  /** The stored state after the write, or null when the rating was cleared. */
  feedback: MealFeedbackState | null
}

/**
 * Persist a post-meal rating for one dinner of the signed-in household's week
 * (#126). Thumbs up / down (and an optional note) are written to `meal_feedback`,
 * which the recommender already folds into next week's taste (recsys/feedback-fold).
 *
 * Idempotent per (household, recipe, plan): re-rating the same dinner UPDATES the
 * existing row rather than stacking duplicates, so the live planner fold (#63)
 * always sees one current signal per dish. Clearing (rating = null) deletes any
 * existing row, so a household can take back a thumbs without leaving a stale
 * signal behind.
 *
 * Scoped to the household: the plan must belong to the signed-in household, so a
 * stranger's plan id is rejected before anything is written.
 *
 * Server-only: every server-only module is dynamically imported inside the handler
 * so none of it leaks into the client bundle (the week-server / swap-server pattern).
 */
export const submitMealFeedback = createServerFn({ method: 'POST' })
  .validator((data: SubmitMealFeedbackRequest) => data)
  .handler(async ({ data }): Promise<SubmitMealFeedbackResponse> => {
    if (!data.planId) throw new Error('planId required')
    if (!data.recipeId) throw new Error('recipeId required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan, mealFeedback } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    // The plan must belong to this household: a stranger's plan id never writes.
    const planRows = await db
      .select({ id: mealPlan.id })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    if (!planRows[0]) throw new Error('Plan not found')

    const row = ratingToFeedbackRow({
      recipeId: data.recipeId,
      mealPlanId: data.planId,
      rating: data.rating,
      note: data.note,
    })

    // The idempotency key: one feedback row per (household, recipe, plan).
    const existing = await db
      .select({ id: mealFeedback.id })
      .from(mealFeedback)
      .where(
        and(
          eq(mealFeedback.householdId, hh.id),
          eq(mealFeedback.recipeId, data.recipeId),
          eq(mealFeedback.mealPlanId, data.planId),
        ),
      )
      .limit(1)
    const existingId = existing[0]?.id ?? null

    const action: FeedbackWriteAction = planFeedbackWrite(existingId, row)
    // The structural MealFeedbackDb/Table interfaces describe just the verbs the
    // write uses; the concrete drizzle/D1 types are wider, so cast at the boundary.
    await applyFeedbackWrite({
      db: db as unknown as MealFeedbackDb,
      table: mealFeedback,
      eq,
      householdId: hh.id,
      action,
    })

    // Feedback bridge: a free-text note ("not pizza every week") becomes durable
    // memory so it shapes future weeks, not just this row. Exactly one LLM call
    // classifies it (variety vs dislike vs ...). Best-effort: a memory failure
    // never blocks saving the feedback itself.
    if (
      (action.kind === 'insert' || action.kind === 'update') &&
      action.row.note &&
      action.row.note.trim()
    ) {
      try {
        const { rememberNote } = await import('./memory/memory-server')
        await rememberNote(hh.id, action.row.note, 'feedback')
      } catch {
        // The note is still saved as feedback; memory is an enhancement.
      }
    }

    // delete/noop carried no row; insert/update have `row` non-null. The stored
    // state echoes the nullable rating (a note-only save returns rating null).
    return {
      feedback:
        action.kind === 'insert' || action.kind === 'update'
          ? {
              recipeId: action.row.recipeId,
              rating: action.row.rating,
              note: action.row.note,
            }
          : null,
    }
  })

/**
 * Read the household's current post-meal ratings for one week, so the week view
 * can reflect what was already rated (show the chosen thumbs, prefill the note).
 * Keyed by recipe id, scoped to the signed-in household's copy of the plan.
 */
export const listMealFeedback = createServerFn({ method: 'GET' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }): Promise<Array<MealFeedbackState>> => {
    if (!data.planId) return []

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan, mealFeedback } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) return []

    const planRows = await db
      .select({ id: mealPlan.id })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    if (!planRows[0]) return []

    const rows = await db
      .select({
        recipeId: mealFeedback.recipeId,
        rating: mealFeedback.rating,
        note: mealFeedback.note,
      })
      .from(mealFeedback)
      .where(
        and(
          eq(mealFeedback.householdId, hh.id),
          eq(mealFeedback.mealPlanId, data.planId),
        ),
      )

    // Keep every row scoped to a recipe — including note-only rows (rating ''),
    // so a saved note rehydrates on reload even when the household left no thumb.
    return mapFeedbackRows(rows)
  })
