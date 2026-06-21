import type { LanguageModel } from 'ai'
import type {
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
  SoftPenalties,
} from '../planner/types'
import type { TermMatcherFactory } from './week-session'

/**
 * Shared server-side loading for the replan agent.
 *
 * Both transports (the chat `/api/replan` route and the VAPI voice tool) need the
 * same four things: the household + its current week, the recipe catalogue, the
 * onboarding swipes, and a place to persist the new revision. This module is the
 * single source of that wiring, so the two callers stay thin and never drift.
 *
 * Server-only: every server-only collaborator (D1 client, schema, env, embeddings)
 * is dynamically imported inside a function so none of it leaks into a client
 * bundle (the planner-server / replan-server pattern).
 */

/** Everything the agent needs to edit and persist a week. */
export interface ReplanContextData {
  householdId: string
  profile: PlannerProfile
  /** The plan revision the week was loaded from. */
  planId: string
  /** Monday of the week, ISO date string. */
  weekStart: string
  /** The current week, normalised to the planner shape. */
  week: PlannedWeek
  /** The full recipe catalogue (the planner's candidate pool). */
  recipes: Array<PlannerRecipe>
  /**
   * The taste signal that seeds the adaptive ranker: onboarding swipes with
   * post-meal feedback folded on top (the closed learning loop).
   */
  swipes: Array<PlannerSwipe>
  /**
   * Memory-derived soft penalties (variety / dislikes / recently-served). Empty
   * for a household with no memory, leaving replan ranking unchanged.
   */
  penalties: SoftPenalties
}

interface HouseholdRow {
  id: string
  profile: PlannerProfile
}

interface PlanRow {
  id: string
  weekStart: string
  plan: {
    days: Array<{ day: string; meal: string; recipeRef?: string | null }>
  }
}

/**
 * Load the catalogue + swipes for a household and assemble the full context from a
 * given plan row. Shared by both the user-scoped (chat) and household-scoped
 * (voice) entry points.
 */
async function assemble(
  hh: HouseholdRow,
  current: PlanRow,
): Promise<ReplanContextData> {
  const { getDb } = await import('../../db/client')
  const { recipe, recipeSwipe } = await import('../../db/schema')
  const { hasImage } = await import('../../db/recipe-filters')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

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
    // Same servable pool as planner-core / loadWeek — never pick foodcom refs the
    // heal pass would swap out on the next page load.
    .where(hasImage)

  const swipeRows = await db
    .select({
      recipeId: recipeSwipe.recipeId,
      direction: recipeSwipe.direction,
    })
    .from(recipeSwipe)
    .where(eq(recipeSwipe.householdId, hh.id))

  const recipes: Array<PlannerRecipe> = recipeRows.map((r) => ({
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

  const onboardingSwipes: Array<PlannerSwipe> = swipeRows
    .filter((s) => s.direction === 'like' || s.direction === 'dislike')
    .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

  // Close the loop for replans too: fold post-meal feedback onto the swipes and
  // load the memory-derived penalties, so a replan learns from thumbs + memory
  // exactly like the first week does (planner-signals is the shared source).
  const { loadPlannerSignals } = await import('../planner-signals')
  const { swipes, penalties } = await loadPlannerSignals(
    hh.id,
    onboardingSwipes,
  )

  const week: PlannedWeek = {
    days: current.plan.days.map((d) => ({
      day: d.day,
      meal: d.meal,
      recipeRef: d.recipeRef ?? '',
    })),
  }

  return {
    householdId: hh.id,
    profile: hh.profile,
    planId: current.id,
    weekStart: current.weekStart,
    week,
    recipes,
    swipes,
    penalties,
  }
}

/**
 * Chat path: load the context for a specific plan owned by the signed-in user.
 * Throws on a missing household (the caller surfaces it); returns null when the
 * plan id does not belong to the household.
 */
export async function loadReplanContextForUser(
  userId: string,
  planId: string,
): Promise<ReplanContextData | null> {
  const { getDb } = await import('../../db/client')
  const { household, mealPlan } = await import('../../db/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.ownerId, userId))
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
    .where(and(eq(mealPlan.id, planId), eq(mealPlan.householdId, hh.id)))
    .limit(1)
  const current = planRows[0]
  if (!current) return null
  return assemble(hh, current)
}

/**
 * Voice path: load a specific plan revision for a household (the week the user
 * had open in the app). Returns null when the plan is missing or not owned.
 */
export async function loadReplanContextForHouseholdPlan(
  householdId: string,
  planId: string,
): Promise<ReplanContextData | null> {
  const { getDb } = await import('../../db/client')
  const { household, mealPlan } = await import('../../db/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) return null

  const planRows = await db
    .select({
      id: mealPlan.id,
      weekStart: mealPlan.weekStart,
      plan: mealPlan.plan,
    })
    .from(mealPlan)
    .where(and(eq(mealPlan.id, planId), eq(mealPlan.householdId, hh.id)))
    .limit(1)
  const current = planRows[0]
  if (!current) return null
  return assemble(hh, current)
}

/**
 * Voice path: load the context for a household's most-recent week (no plan id over
 * voice). Returns null when the household has no plan yet.
 */
export async function loadReplanContextForHousehold(
  householdId: string,
): Promise<ReplanContextData | null> {
  const { getDb } = await import('../../db/client')
  const { household, mealPlan } = await import('../../db/schema')
  const { eq, desc } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) return null

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
  return assemble(hh, current)
}

/**
 * Resolve the newest `meal_plan` revision for a household. When `anchorPlanId` is
 * given, returns the latest revision for that anchor's `weekStart`; otherwise the
 * household's most recent plan overall.
 */
export async function resolveLatestPlanRowForHousehold(
  householdId: string,
  anchorPlanId?: string,
): Promise<PlanRow | null> {
  const { getDb } = await import('../../db/client')
  const { mealPlan } = await import('../../db/schema')
  const { eq, and, desc } = await import('drizzle-orm')
  const db = await getDb()

  const selectPlan = {
    id: mealPlan.id,
    weekStart: mealPlan.weekStart,
    plan: mealPlan.plan,
  }

  if (anchorPlanId) {
    const anchor = await db
      .select({ weekStart: mealPlan.weekStart })
      .from(mealPlan)
      .where(
        and(
          eq(mealPlan.id, anchorPlanId),
          eq(mealPlan.householdId, householdId),
        ),
      )
      .limit(1)
    const row = anchor[0]
    if (row) {
      const latest = await db
        .select(selectPlan)
        .from(mealPlan)
        .where(
          and(
            eq(mealPlan.householdId, householdId),
            eq(mealPlan.weekStart, row.weekStart),
          ),
        )
        .orderBy(desc(mealPlan.createdAt))
        .limit(1)
      if (latest[0]) return latest[0]
    }
  }

  const fallback = await db
    .select(selectPlan)
    .from(mealPlan)
    .where(eq(mealPlan.householdId, householdId))
    .orderBy(desc(mealPlan.createdAt))
    .limit(1)
  return fallback[0] ?? null
}

/**
 * Voice path: load the latest revision for the week the user had open (or the
 * household's newest plan when the anchor id is missing / stale). Returns null
 * only when the household has no plan rows.
 */
export async function loadVoiceReplanContext(
  householdId: string,
  anchorPlanId?: string,
): Promise<ReplanContextData | null> {
  const { getDb } = await import('../../db/client')
  const { household } = await import('../../db/schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) return null

  const planRow = await resolveLatestPlanRowForHousehold(
    householdId,
    anchorPlanId,
  )
  if (!planRow) return null
  return assemble(hh, planRow)
}

/**
 * Persist a replanned week as a NEW meal_plan revision (the old row is kept, so a
 * replan is reversible). Returns the new plan id.
 */
export async function persistRevision(
  householdId: string,
  weekStart: string,
  week: PlannedWeek,
): Promise<string> {
  const { getDb } = await import('../../db/client')
  const { mealPlan } = await import('../../db/schema')
  const db = await getDb()
  const newId = crypto.randomUUID()
  await db.insert(mealPlan).values({
    id: newId,
    householdId,
    weekStart,
    plan: {
      days: week.days.map((d) => ({
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef,
      })),
      shoppingList: [],
    },
    status: 'draft',
  })
  return newId
}

/**
 * Build the agent's language model, gated on the OPENAI_API_KEY secret (read via
 * `readEnv`, which covers both vite dev's process.env and the deployed Worker's
 * binding). With no key, `aiAvailable` is false and the caller declines the
 * free-text agent cleanly. The provider import is lazy so it never reaches the
 * client bundle.
 */
export async function buildReplanModel(): Promise<{
  model: LanguageModel | null
  aiAvailable: boolean
}> {
  const { readEnv } = await import('../env')
  const key = await readEnv('OPENAI_API_KEY')
  if (!key) return { model: null, aiAvailable: false }
  try {
    const { models } = await import('../models')
    return { model: models.fast, aiAvailable: true }
  } catch {
    return { model: null, aiAvailable: false }
  }
}

/**
 * Build the on-demand term-matcher factory for exclude / lean-more (ADR-0004).
 *
 * The agent may pick any term at runtime, so unlike the old single-term path we
 * embed per call: the factory takes a term, embeds it live (needs the OpenAI key),
 * and scores it against the precomputed recipe vectors. With no key (or a vector
 * load failure) we return undefined, so the term-driven tools decline cleanly with
 * no substring fallback.
 */
export async function buildMatcherFactory(): Promise<
  TermMatcherFactory | undefined
> {
  const { embeddingKeyPresent, embedQuery } =
    await import('../embeddings/embed')
  if (!embeddingKeyPresent()) return undefined
  try {
    const { getRecipeVectorMap } = await import('../embeddings/store')
    const recipeVectors = await getRecipeVectorMap()
    const { buildTermMatcherLive, combineTermMatchers, substringTermMatcher } =
      await import('../replan/term-match')
    return async (term: string) => {
      const embedding = await buildTermMatcherLive(
        term,
        recipeVectors,
        embedQuery,
      )
      const substring = substringTermMatcher(term)
      return combineTermMatchers(embedding, substring)
    }
  } catch {
    return undefined
  }
}
