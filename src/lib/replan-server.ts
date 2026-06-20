import { createServerFn } from '@tanstack/react-start'
import type { LanguageModel } from 'ai'
import type { PlannedWeek } from './planner/types'
import type { ReplanResult } from './replan/types'

export interface ReplanRequest {
  /** The plan id to edit (the current week). */
  planId: string
  /** The plain-language instruction ("eating out Wednesday", "no fish"). */
  instruction: string
  /**
   * The day the user is looking at, if any. Used by swap intents that name no day
   * ("not this one"). Optional.
   */
  focusedDay?: string
}

export interface ReplanResponse {
  /** The new meal_plan revision id (a fresh row; the old one is kept). */
  planId: string
  /** Monday of the week, ISO date string. */
  weekStart: string
  /** The new week. */
  week: PlannedWeek
  /** Whether the week actually changed. */
  changed: boolean
  /** A short message for the user. */
  message: string
  /** Whether the edit came from the deterministic parser or the AI fallback. */
  source: ReplanResult['source']
}

/**
 * Replan the signed-in household's week from a plain-language instruction.
 *
 * Reads meal_plan (the current week) + recipe (the catalogue) + household.profile
 * + the onboarding swipes, runs the pure replan engine (deterministic parse, AI
 * fallback for the long tail), and writes the result as a NEW meal_plan row (a
 * revision; we never overwrite the old week). Returns the new plan id and week.
 *
 * Server-only: every server-only module is dynamically imported inside the
 * handler so none of it leaks into the client bundle (the onboarding-server /
 * planner-server pattern). The AI model is likewise loaded lazily and only when
 * the ANTHROPIC_API_KEY binding is present; with no key the fallback declines
 * cleanly and the engine returns a clear "can't do that yet".
 */
export const replanWeek = createServerFn({ method: 'POST' })
  .validator((data: ReplanRequest) => data)
  .handler(async ({ data }): Promise<ReplanResponse> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, recipeSwipe, mealPlan } =
      await import('../db/schema')
    const { replan } = await import('./replan/replan')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const planRows = await db
      .select({
        id: mealPlan.id,
        weekStart: mealPlan.weekStart,
        plan: mealPlan.plan,
      })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const current = planRows[0]
    if (!current) throw new Error('Plan not found')

    const recipeRows = await db
      .select({
        id: recipe.id,
        title: recipe.title,
        cuisine: recipe.cuisine,
        category: recipe.category,
        dietaryTags: recipe.dietaryTags,
        ingredients: recipe.ingredients,
        calories: recipe.calories,
        protein: recipe.protein,
        prepMinutes: recipe.prepMinutes,
        mealType: recipe.mealType,
      })
      .from(recipe)

    const swipeRows = await db
      .select({
        recipeId: recipeSwipe.recipeId,
        direction: recipeSwipe.direction,
      })
      .from(recipeSwipe)
      .where(eq(recipeSwipe.householdId, hh.id))

    const recipes = recipeRows.map((r) => ({
      id: r.id,
      title: r.title,
      cuisine: r.cuisine,
      category: r.category,
      dietaryTags: r.dietaryTags,
      ingredients: r.ingredients.map((i) => ({ name: i.name })),
      calories: r.calories,
      protein: r.protein,
      prepMinutes: r.prepMinutes,
      mealType: r.mealType,
    }))

    const swipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    // The current week, normalised to the engine's shape. A focused day with no
    // named day in the instruction lets a "swap this one" target the right day.
    const week: PlannedWeek = {
      days: current.plan.days.map((d) => ({
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef ?? '',
      })),
    }

    // Wire the AI model only when the key is present (gated, offline-safe). The
    // provider import is lazy so it never reaches the client bundle.
    const aiDeps = await buildAiDeps()

    const result = await replan(
      decorateInstruction(data.instruction, data.focusedDay, week),
      { week, recipes, profile: hh.profile, swipes },
      aiDeps,
    )

    // Persist a new revision. We keep the old row so a replan is reversible.
    const newId = crypto.randomUUID()
    await db.insert(mealPlan).values({
      id: newId,
      householdId: hh.id,
      weekStart: current.weekStart,
      plan: {
        days: result.week.days.map((d) => ({
          day: d.day,
          meal: d.meal,
          recipeRef: d.recipeRef,
        })),
        shoppingList: [],
      },
      status: 'draft',
    })

    return {
      planId: newId,
      weekStart: current.weekStart,
      week: result.week,
      changed: result.changed,
      message: result.message,
      source: result.source,
    }
  })

/**
 * Replan a household's CURRENT (most recent) week from a plain-language
 * instruction, identified by `householdId` rather than the request cookie.
 *
 * This is the internal entry point the VAPI tool webhook uses: that call is
 * server-to-server and carries no session cookie, so identity comes from the
 * signed call token (verified to a `householdId`), not `getSessionUser`. It picks
 * the household's latest meal_plan row as the week to edit (the in-app replan
 * always edits the plan the user is looking at; voice has no such context, so it
 * targets the newest), runs the same pure replan engine, and persists a new
 * revision exactly like `replanWeek`. Returns null if the household has no plan.
 *
 * Server-only: dynamic imports keep the D1 binding and the engine out of the
 * client bundle (the planner-server pattern).
 */
export async function replanForHousehold(
  householdId: string,
  instruction: string,
): Promise<ReplanResponse | null> {
  const { getDb } = await import('../db/client')
  const { recipe, recipeSwipe, mealPlan, household } =
    await import('../db/schema')
  const { replan } = await import('./replan/replan')
  const { eq, desc } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) return null

  // No plan id over voice: edit the household's most recent week.
  const planRows = await db
    .select({
      id: mealPlan.id,
      weekStart: mealPlan.weekStart,
      plan: mealPlan.plan,
    })
    .from(mealPlan)
    .where(eq(mealPlan.householdId, hh.id))
    .orderBy(desc(mealPlan.createdAt))
    .limit(1)
  const current = planRows[0]
  if (!current) return null

  const recipeRows = await db
    .select({
      id: recipe.id,
      title: recipe.title,
      cuisine: recipe.cuisine,
      category: recipe.category,
      dietaryTags: recipe.dietaryTags,
      ingredients: recipe.ingredients,
      calories: recipe.calories,
      protein: recipe.protein,
      prepMinutes: recipe.prepMinutes,
      mealType: recipe.mealType,
    })
    .from(recipe)

  const swipeRows = await db
    .select({
      recipeId: recipeSwipe.recipeId,
      direction: recipeSwipe.direction,
    })
    .from(recipeSwipe)
    .where(eq(recipeSwipe.householdId, hh.id))

  const recipes = recipeRows.map((r) => ({
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    category: r.category,
    dietaryTags: r.dietaryTags,
    ingredients: r.ingredients.map((i) => ({ name: i.name })),
    calories: r.calories,
    protein: r.protein,
    prepMinutes: r.prepMinutes,
    mealType: r.mealType,
  }))

  const swipes = swipeRows
    .filter((s) => s.direction === 'like' || s.direction === 'dislike')
    .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

  const week: PlannedWeek = {
    days: current.plan.days.map((d) => ({
      day: d.day,
      meal: d.meal,
      recipeRef: d.recipeRef ?? '',
    })),
  }

  const aiDeps = await buildAiDeps()
  const result = await replan(
    instruction,
    { week, recipes, profile: hh.profile, swipes },
    aiDeps,
  )

  const newId = crypto.randomUUID()
  await db.insert(mealPlan).values({
    id: newId,
    householdId: hh.id,
    weekStart: current.weekStart,
    plan: {
      days: result.week.days.map((d) => ({
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef,
      })),
      shoppingList: [],
    },
    status: 'draft',
  })

  return {
    planId: newId,
    weekStart: current.weekStart,
    week: result.week,
    changed: result.changed,
    message: result.message,
    source: result.source,
  }
}

/**
 * If the user gave no day but is focused on one ("not this one" while looking at
 * Friday), fold the focused day into the instruction so the deterministic swap
 * path can target it. Pure string shaping, no engine logic.
 */
function decorateInstruction(
  instruction: string,
  focusedDay: string | undefined,
  _week: PlannedWeek,
): string {
  if (!focusedDay) return instruction
  const hasDay =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      instruction,
    )
  return hasDay ? instruction : `${instruction} ${focusedDay}`
}

/**
 * Build the AI fallback deps. Returns an empty object (no model) unless an
 * ANTHROPIC_API_KEY is wired, in which case the model is loaded lazily. Kept here
 * (server-only) so the provider never enters the client bundle.
 */
async function buildAiDeps(): Promise<{
  model?: LanguageModel | null
}> {
  // The key lives as a Worker secret. With no key the fallback declines cleanly.
  const env = typeof process !== 'undefined' ? process.env : undefined
  const key = env ? env.ANTHROPIC_API_KEY : undefined
  if (!key) return {}
  try {
    const { models } = await import('./models')
    return { model: models.fast }
  } catch {
    return {}
  }
}
