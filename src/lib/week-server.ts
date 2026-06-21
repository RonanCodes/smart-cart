import { createServerFn } from '@tanstack/react-start'
import type { MealFeedbackState } from './meal-feedback-server'

/**
 * One ready alternative for a day, denormalised with the same card detail the
 * day itself shows, so the edit sheet (tap a day -> pick from ~5 alternatives)
 * can render appetizing cards with no extra round-trip.
 */
export interface DayAlternative {
  /** The alternative recipe id, written into the plan when picked. */
  recipeRef: string
  /** The recipe's title. */
  meal: string
  /** Cuisine label, when the recipe has one. */
  cuisine: string | null
  /** Prep time in minutes, when known. */
  prepMinutes: number | null
  /** kcal per serving, when known. */
  calories: number | null
  /** grams of protein per serving, when known. */
  protein: number | null
  /** Hero image URL, when the source recipe carried one. */
  imageUrl: string | null
}

/**
 * One day's dinner in the week view, denormalised with the recipe detail the
 * cards render: title, cuisine, prep time, calories/protein when known, and the
 * image. A day the user is eating out has an empty `recipeRef` and no detail.
 */
export interface WeekDayView {
  /** Day label, Monday first. */
  day: string
  /** The chosen recipe's title (empty string when the day is skipped). */
  meal: string
  /** The chosen recipe id, the stable reference into the catalogue. */
  recipeRef: string
  /** Cuisine label, when the recipe has one. */
  cuisine: string | null
  /** Prep time in minutes, when known. */
  prepMinutes: number | null
  /** kcal per serving, when known. */
  calories: number | null
  /** grams of protein per serving, when known. */
  protein: number | null
  /** Hero image URL, when the source recipe carried one. */
  imageUrl: string | null
  /** Cached living-photo cooking video URL (recipe_media), null when none yet. */
  videoUrl: string | null
  /**
   * ~5 ready alternatives for this day, pre-ranked for the household and already
   * excluding the current pick + the rest of the week (no dupes). Shipped with
   * the week so the edit sheet opens instantly. Empty for a skipped ('out') day.
   */
  alternatives: Array<DayAlternative>
}

export interface WeekView {
  /** The stable meal_plan id this view was loaded from. */
  planId: string
  /** Monday of the planned week, ISO date string. */
  weekStart: string
  /** Seven dinners, Monday first. */
  days: Array<WeekDayView>
}

/**
 * Load a persisted week by plan id and enrich each day with the recipe detail the
 * cards need. Reads meal_plan (the stored week) + recipe (for the per-day detail).
 * The plan must belong to the signed-in household, so a stranger's plan id can
 * never be read.
 *
 * Server-only: every server-only module is dynamically imported inside the
 * handler so none of it leaks into the client bundle (the planner-server pattern).
 */
export const loadWeek = createServerFn({ method: 'GET' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }): Promise<WeekView> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, recipeSwipe, mealPlan } =
      await import('../db/schema')
    const { eq, and, inArray } = await import('drizzle-orm')
    const { recipeMedia } = await import('../db/recipe-media-schema')
    const { hasImage } = await import('../db/recipe-filters')
    const { topNForDay } = await import('./planner/planner')
    const { healWeekPlan } = await import('./heal/heal-week-plan')
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

    // Load the full candidate catalogue + the household's swipes once, then rank
    // the top-N alternatives per day in-process. The ranking is fast (it is the
    // same one that built this week), so shipping the alternatives with the week
    // makes the edit sheet open instantly with no extra round-trip. Only recipes
    // with an image surface as cards (same rule as the week + similar swap).
    const catalogueRows = await db
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
        raw: recipe.raw,
      })
      .from(recipe)
      .where(hasImage)

    const swipeRows = await db
      .select({
        recipeId: recipeSwipe.recipeId,
        direction: recipeSwipe.direction,
      })
      .from(recipeSwipe)
      .where(eq(recipeSwipe.householdId, hh.id))

    const catalogue = catalogueRows.map((r) => ({
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

    const imageById = new Map(
      catalogueRows.map((r) => [
        r.id,
        ((r.raw as { imageUrl?: string | null } | null) ?? null)?.imageUrl ??
          null,
      ]),
    )

    const swipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    // Auto-heal stale days. A plan built before the #161 AH/Jumbo + image filter
    // can reference an old foodcom / themealdb recipe that no longer surfaces as a
    // card (e.g. it renders with no image). The servable set is exactly the
    // catalogue we just loaded with `hasImage`. For any day pointing at a recipe
    // outside that set, swap in the top servable alternative (same hard filter +
    // no-repeat logic the week + the edit sheet use), then persist the healed week
    // as a NEW revision so the repair sticks. An all-servable plan is untouched
    // (no write, no behaviour change). One healed write max per load.
    const servableIds = new Set(catalogueRows.map((r) => r.id))
    const { days: healedDays, changed: planChanged } = healWeekPlan(
      current.plan.days,
      servableIds,
      (day, excludeIds) => {
        // The single best servable alternative for this day, honouring the same
        // hard filters + no-repeat exclusions as the per-day alternatives below.
        const pick = topNForDay(catalogue, hh.profile, swipes, {
          excludeRecipeId: day.recipeRef || null,
          weekRecipeIds: Array.from(excludeIds),
          dayType: day.type ?? 'home',
          n: 1,
        })[0]
        return pick ? { id: pick.id, title: pick.title } : null
      },
    )

    // The plan the view renders from. When nothing was stale this is the stored
    // plan unchanged; when something was healed it is the repaired week, persisted
    // below as a fresh revision (mirroring swap-server / replan-server: never an
    // overwrite, so the old week stays in history).
    let planId = current.id
    if (planChanged) {
      const newId = crypto.randomUUID()
      await db.insert(mealPlan).values({
        id: newId,
        householdId: hh.id,
        weekStart: current.weekStart,
        plan: {
          days: healedDays,
          shoppingList: current.plan.shoppingList,
        },
        status: 'draft',
      })
      planId = newId
    }

    const ids = healedDays
      .map((d) => d.recipeRef)
      .filter((r): r is string => !!r)

    const detailRows = ids.length
      ? await db
          .select({
            id: recipe.id,
            cuisine: recipe.cuisine,
            prepMinutes: recipe.prepMinutes,
            calories: recipe.calories,
            protein: recipe.protein,
            raw: recipe.raw,
          })
          .from(recipe)
          .where(inArray(recipe.id, ids))
      : []

    const detail = new Map(detailRows.map((r) => [r.id, r]))

    // Cached living-photo videos for this week's recipes (recipe_media), so the
    // week cards can autoplay them. One batched read; recipes with no clip map to
    // null and render as a plain photo.
    const mediaRows = ids.length
      ? await db
          .select({
            recipeId: recipeMedia.recipeId,
            videoUrl: recipeMedia.videoUrl,
          })
          .from(recipeMedia)
          .where(inArray(recipeMedia.recipeId, ids))
      : []
    const videoById = new Map(mediaRows.map((m) => [m.recipeId, m.videoUrl]))

    // Every recipe placed in the week is off-limits as an alternative, so picking
    // one can never create a duplicate. Includes each day's current pick.
    const weekRecipeIds = ids

    const days: Array<WeekDayView> = healedDays.map((d) => {
      const r = d.recipeRef ? detail.get(d.recipeRef) : undefined
      const raw = (r?.raw as { imageUrl?: string | null } | null) ?? null

      const alts = topNForDay(catalogue, hh.profile, swipes, {
        excludeRecipeId: d.recipeRef || null,
        weekRecipeIds,
        dayType: d.type ?? 'home',
        n: 5,
      })

      const alternatives: Array<DayAlternative> = alts.map((a) => ({
        recipeRef: a.id,
        meal: a.title,
        cuisine: a.cuisine ?? null,
        prepMinutes: a.prepMinutes ?? null,
        calories: a.calories ?? null,
        protein: a.protein ?? null,
        imageUrl: imageById.get(a.id) ?? null,
      }))

      return {
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef ?? '',
        cuisine: r?.cuisine ?? null,
        prepMinutes: r?.prepMinutes ?? null,
        calories: r?.calories ?? null,
        protein: r?.protein ?? null,
        imageUrl: raw?.imageUrl ?? null,
        videoUrl: (d.recipeRef ? videoById.get(d.recipeRef) : null) ?? null,
        alternatives,
      }
    })

    return { planId, weekStart: current.weekStart, days }
  })

/**
 * Resolve the newest meal_plan revision for the same week as `planId`. Used after
 * a voice replan so the week view can adopt the persisted revision the agent wrote
 * (voice has no stream to push plan ids back to the browser).
 */
export const resolveLatestPlanId = createServerFn({ method: 'POST' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }): Promise<{ planId: string }> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan } = await import('../db/schema')
    const { eq, and, desc } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const anchor = await db
      .select({ weekStart: mealPlan.weekStart })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const row = anchor[0]
    if (!row) throw new Error('Plan not found')

    const latest = await db
      .select({ id: mealPlan.id })
      .from(mealPlan)
      .where(
        and(
          eq(mealPlan.householdId, hh.id),
          eq(mealPlan.weekStart, row.weekStart),
        ),
      )
      .orderBy(desc(mealPlan.createdAt))
      .limit(1)
    const plan = latest[0]
    if (!plan) throw new Error('Plan not found')

    return { planId: plan.id }
  })

/** Everything the /week route's loader needs, in one server round-trip (#251). */
export interface WeekBootstrap {
  week: WeekView
  feedback: Array<MealFeedbackState>
  missingFromList: number
}

/**
 * Reshape the three /week reads into the loader's payload (#251). Pure glue, so
 * the "batched shape == old 3-call shape" guarantee is unit-testable without the
 * DB/session chain. Mirrors exactly what the old loader's Promise.all returned:
 * `{ week, feedback, missingFromList: missing.missing }`.
 */
export function composeWeekBootstrap(
  week: WeekView,
  feedback: Array<MealFeedbackState>,
  missing: { missing: number },
): WeekBootstrap {
  return { week, feedback, missingFromList: missing.missing }
}

/**
 * The /week loader, batched into ONE round-trip (#251). The route used to fan out
 * three GET server fns per visit (loadWeek + listMealFeedback + countMissingFromWeek
 * in a Promise.all); this composes the same three server-only reads INSIDE one
 * server handler, so the client makes a single call. Behaviour is unchanged: it
 * runs the exact same three reads in parallel and returns the same shape the
 * loader returned before.
 */
export const loadWeekBootstrap = createServerFn({ method: 'GET' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }): Promise<WeekBootstrap> => {
    const { listMealFeedback } = await import('./meal-feedback-server')
    const { countMissingFromWeek } = await import('./shopping-list-server')
    const [week, feedback, missing] = await Promise.all([
      loadWeek({ data: { planId: data.planId } }),
      listMealFeedback({ data: { planId: data.planId } }),
      countMissingFromWeek({ data: { planId: data.planId } }),
    ])
    return composeWeekBootstrap(week, feedback, missing)
  })

/**
 * The result of navigating to a week by offset (Part A). Either a loaded week
 * (current/future, generated on demand if it didn't exist; or a past week that
 * happened to have a plan) OR an empty state (a past week with no plan, which we
 * never generate). `offset` and `weekStart` echo what was resolved so the UI can
 * label the week + keep the URL deep-linkable.
 */
export type WeekForOffsetResult =
  | { kind: 'week'; offset: number; weekStart: string; week: WeekView }
  | { kind: 'empty'; offset: number; weekStart: string }

/**
 * Load the signed-in household's plan for a week OFFSET (Part A): 0 = this week's
 * Monday, +1 = next week, -1 = last week, etc. Resolves the target Monday from
 * today ± offset weeks, finds the newest meal_plan stamped to that weekStart, and:
 *   - if one exists, returns the enriched week (via loadWeek);
 *   - if none exists and offset >= 0 (current/future), GENERATES one stamped to
 *     that weekStart (so "next week" is created on demand the first time it's
 *     opened), then returns it;
 *   - if none exists and offset < 0 (a past week), returns an empty state — we
 *     never back-fill history.
 *
 * Server-only deps are dynamically imported (the week-server pattern).
 */
export const loadWeekForOffset = createServerFn({ method: 'GET' })
  .validator((data: { offset: number }) => data)
  .handler(async ({ data }): Promise<WeekForOffsetResult> => {
    const offset = Math.trunc(data.offset)
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan } = await import('../db/schema')
    const { eq, and, desc } = await import('drizzle-orm')
    const { weekStartForOffset } = await import('./week-offset')
    const db = await getDb()

    const hh = (
      await db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.ownerId, user.id))
        .limit(1)
    )[0]
    if (!hh) throw new Error('No household, onboard first')

    const weekStart = weekStartForOffset(offset)

    const existing = (
      await db
        .select({ id: mealPlan.id })
        .from(mealPlan)
        .where(
          and(
            eq(mealPlan.householdId, hh.id),
            eq(mealPlan.weekStart, weekStart),
          ),
        )
        .orderBy(desc(mealPlan.createdAt))
        .limit(1)
    )[0]

    if (existing) {
      const week = await loadWeek({ data: { planId: existing.id } })
      return { kind: 'week', offset, weekStart, week }
    }

    // No plan for that week. Generate only for current/future weeks; never
    // back-fill the past.
    if (offset < 0) {
      return { kind: 'empty', offset, weekStart }
    }

    const { generatePlanForHousehold } = await import('./planner-core')
    const { planId } = await generatePlanForHousehold(hh.id, weekStart)
    const week = await loadWeek({ data: { planId } })
    return { kind: 'week', offset, weekStart, week }
  })

/**
 * The household's newest meal_plan id (by createdAt). Used by the in-app voice
 * flow (#17): a voice replan writes a NEW plan revision server-to-server, so the
 * open week page can't know its id. After a voice action the client calls this,
 * and if the id differs from what it's showing, reloads that plan and glows the
 * days that changed. Returns null when the household has no plan yet.
 */
export const latestPlanId = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ planId: string | null }> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, mealPlan } = await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()

    const hh = (
      await db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.ownerId, user.id))
        .limit(1)
    )[0]
    if (!hh) return { planId: null }

    const row = (
      await db
        .select({ id: mealPlan.id })
        .from(mealPlan)
        .where(eq(mealPlan.householdId, hh.id))
        .orderBy(desc(mealPlan.createdAt))
        .limit(1)
    )[0]
    return { planId: row?.id ?? null }
  },
)
