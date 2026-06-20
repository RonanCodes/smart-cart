import { createServerFn } from '@tanstack/react-start'
import { planFeedbackWrite, ratingToFeedbackRow } from './meal-feedback'
import type { MealRating } from './meal-feedback'

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
  rating: 'up' | 'down'
  note: string | null
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

    const action = planFeedbackWrite(existingId, row)
    switch (action.kind) {
      case 'delete':
        await db.delete(mealFeedback).where(eq(mealFeedback.id, action.id))
        return { feedback: null }
      case 'noop':
        return { feedback: null }
      case 'update':
        await db
          .update(mealFeedback)
          .set({
            rating: action.row.rating,
            note: action.row.note,
            createdAt: new Date(),
          })
          .where(eq(mealFeedback.id, action.id))
        break
      case 'insert':
        await db.insert(mealFeedback).values({
          id: crypto.randomUUID(),
          householdId: hh.id,
          mealPlanId: action.row.mealPlanId,
          recipeId: action.row.recipeId,
          rating: action.row.rating,
          note: action.row.note,
          createdAt: new Date(),
        })
        break
    }

    // Reached only on insert/update, so `row` is non-null here.
    return {
      feedback: row
        ? { recipeId: row.recipeId, rating: row.rating, note: row.note }
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

    return rows
      .filter(
        (
          r,
        ): r is {
          recipeId: string
          rating: 'up' | 'down'
          note: string | null
        } => !!r.recipeId && (r.rating === 'up' || r.rating === 'down'),
      )
      .map((r) => ({ recipeId: r.recipeId, rating: r.rating, note: r.note }))
  })
