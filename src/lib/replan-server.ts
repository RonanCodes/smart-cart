import { createServerFn } from '@tanstack/react-start'
import type { LanguageModel } from 'ai'
import type { PlannedWeek } from './planner/types'
import type { ReplanResult } from './replan/types'
import type { TermMatchDeps } from './replan/replan'

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
 * the OPENAI_API_KEY secret is present; with no key the fallback declines
 * cleanly and the engine returns a clear "AI adjustments are off" message,
 * degrading to the deterministic set-maths planner.
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

    // Wire the AI model only when the OPENAI_API_KEY is present (gated,
    // offline-safe). The provider import is lazy so it never reaches the client
    // bundle. `aiAvailable` lets us tell the user WHY a non-deterministic
    // instruction was declined (no key) vs the model simply not understanding it.
    const { deps: aiDeps, aiAvailable } = await buildAiDeps()

    // Wire the embedding term-matcher for exclude / more-of (ADR-0004). It embeds
    // the typed term live (needs the OpenAI key) and scores it against the
    // precomputed recipe vectors. With no key, `termMatch` carries nothing and the
    // term intents decline cleanly (no substring fallback).
    const termMatch = await buildTermMatchDeps()

    const result = await replan(
      decorateInstruction(data.instruction, data.focusedDay, week),
      { week, recipes, profile: hh.profile, swipes },
      aiDeps,
      termMatch,
    )

    // Graceful degrade: an `unknown` edit from the AI fallback with no model wired
    // means we fell back to the set-maths planner and it could not read the
    // free-form instruction. Surface that honestly instead of a generic shrug, so
    // a dev with no key (or prod with the secret unset) sees the real reason.
    const message =
      !aiAvailable &&
      result.source === 'ai-fallback' &&
      result.edit.type === 'unknown'
        ? "AI adjustments are off (no API key set), so I can only handle the built-in changes. Try 'eating out Wednesday', 'no fish', 'swap Friday', or 'more pasta'."
        : result.message

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
      message,
      source: result.source,
    }
  })

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
 * Build the AI fallback deps.
 *
 * The active provider is OpenAI (`models.fast` = `openai('gpt-5')`), so the gate
 * is the OPENAI_API_KEY secret read via `readEnv` (covers both vite dev's
 * process.env from .dev.vars AND the deployed Worker's `cloudflare:workers` env
 * binding). With no key, `aiAvailable` is false and `deps` carries no model, so
 * the engine degrades to the deterministic set-maths planner and declines
 * free-form instructions cleanly instead of crashing.
 *
 * Kept here (server-only, behind createServerFn + dynamic import) so the provider
 * never enters the client bundle.
 */
async function buildAiDeps(): Promise<{
  deps: { model?: LanguageModel | null }
  aiAvailable: boolean
}> {
  const { readEnv } = await import('./env')
  const key = await readEnv('OPENAI_API_KEY')
  if (!key) return { deps: {}, aiAvailable: false }
  try {
    const { models } = await import('./models')
    return { deps: { model: models.fast }, aiAvailable: true }
  } catch {
    return { deps: {}, aiAvailable: false }
  }
}

/**
 * Build the embedding term-match deps for exclude / more-of (ADR-0004).
 *
 * The typed term ("mushroom", "fish") must be embedded live, which needs the
 * OPENAI_API_KEY. With no key we return empty deps, so the engine declines the term
 * intents cleanly (no substring fallback). With a key we load the precomputed recipe
 * vector index from D1 and hand the engine `embedQuery`; the term is embedded once
 * per replan and scored against every recipe's vector.
 *
 * Server-only: the embed module is server-only (it throws with no key) and the
 * store reads D1, so both are dynamically imported behind the createServerFn.
 */
async function buildTermMatchDeps(): Promise<TermMatchDeps> {
  const { embeddingKeyPresent, embedQuery } = await import('./embeddings/embed')
  if (!embeddingKeyPresent()) return {}
  try {
    const { getRecipeVectorMap } = await import('./embeddings/store')
    const recipeVectors = await getRecipeVectorMap()
    return { embedTerm: embedQuery, recipeVectors }
  } catch {
    // A vector load / decode failure must never crash a replan; degrade to the
    // no-matcher path (the term intent declines cleanly).
    return {}
  }
}
