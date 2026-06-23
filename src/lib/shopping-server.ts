import { createServerFn } from '@tanstack/react-start'
import { consolidate, sharedAcrossMeals, summariseWaste } from './shopping'
import { splitQtyAndUnit } from './shopping/parse'
import type {
  HouseholdPortions,
  ShoppingLine,
  ShoppingList,
  ShoppingRecipe,
  WasteSummary,
  ShoppingItem,
} from './shopping'
import type { StapleLine, FrequentStaple } from './staples-server'
import type { StoreSlug } from './store-pref-server'
import { pickTitle, pickIngredients } from './recipe-locale'

/**
 * The shopping-list view's payload: the consolidated list, the subset of lines
 * shared across more than one meal (surfaced prominently in the UI), and the
 * plan id the list was derived from. `plan` is null when the household has no
 * week planned yet, which the route renders as an empty state.
 */
export interface ShoppingListView {
  /** The plan id the list was built from (null = no plan yet). */
  planId: string | null
  /**
   * When the caller passed an explicit `?plan=` id that does not belong to this
   * household, so the consolidated view is empty and the persisted list must not
   * be shown as if it were that plan.
   */
  missingPlanId: string | null
  /** Monday of the planned week, ISO date string (null = no plan). */
  weekStart: string | null
  /** The household portions the quantities were scaled to. */
  portions: HouseholdPortions
  /** The full consolidated list. */
  list: ShoppingList
  /** Lines used in more than one meal, in list order (the interlink view). */
  shared: Array<ShoppingLine>
  /** The food-waste reduction summary derived from the list (slice #80). */
  waste: WasteSummary
  /**
   * True when any contributing recipe's amounts are LLM-estimated (#313), so the
   * list amounts and the waste figures should be labelled "approx" in the UI.
   */
  amountsEstimated: boolean
}

/**
 * The minimal DB shapes the pure derivation needs. Kept here (not imported from
 * the schema) so `deriveShoppingView` stays unit-testable without a DB.
 */
export interface PlanDayRef {
  recipeRef?: string
}
export interface PlanRecipe {
  id: string
  title: string
  servings?: number | null
  ingredients: Array<{ name: string; qty?: string; unit?: string }>
  /** True when this recipe's amounts are LLM-estimated, not from the source (#313). */
  quantitiesEstimated?: boolean | null
}

/** An empty list, used when there is no plan or no usable recipes. */
function emptyList(): ShoppingList {
  return {
    lines: [],
    targetServings: 0,
    estimatedItems: 0,
  }
}

/**
 * Pure glue: turn a plan's day refs + the looked-up recipes + the household
 * portions into the consolidated shopping view. No DB, no I/O. This is the seam
 * the unit test exercises; the server handler below is just the DB wiring around
 * it.
 *
 * Only days that actually reference a recipe contribute. A recipe referenced by
 * the plan but missing from the catalogue is skipped rather than throwing, so a
 * stale plan still produces a list for the meals that resolve.
 */
export function deriveShoppingView(
  days: Array<PlanDayRef>,
  recipesById: Map<string, PlanRecipe>,
  portions: HouseholdPortions,
): {
  list: ShoppingList
  shared: Array<ShoppingLine>
  waste: WasteSummary
  amountsEstimated: boolean
} {
  // A recipe used on N days contributes N times. We keep one ShoppingRecipe per
  // day-occurrence so portion scaling reflects cooking it more than once.
  const recipes: Array<ShoppingRecipe> = []
  // Any contributing recipe with estimated amounts taints the whole list as
  // approx, since the consolidated totals mix its estimates in.
  let amountsEstimated = false
  for (const d of days) {
    if (!d.recipeRef) continue
    const r = recipesById.get(d.recipeRef)
    if (!r) continue
    if (r.quantitiesEstimated) amountsEstimated = true
    recipes.push({
      id: r.id,
      title: r.title,
      servings: r.servings ?? null,
      ingredients: r.ingredients.map((i) => {
        // Scraped / seeded recipes pack the amount and the unit into a single
        // `qty` field ("350 g", "2 el") with no separate `unit`. Split them so
        // the engine can parse the number AND normalise the unit, instead of
        // treating "350 g" as an unparsable note and dropping the amount (#238).
        // When the source already gave a separate unit we trust it untouched.
        if (i.unit && i.unit.trim() !== '') {
          return { name: i.name, qty: i.qty, unit: i.unit }
        }
        const split = splitQtyAndUnit(i.qty)
        return { name: i.name, qty: split.qty, unit: split.unit }
      }),
    })
  }

  if (recipes.length === 0) {
    const empty = emptyList()
    return {
      list: empty,
      shared: [],
      waste: summariseWaste(empty),
      amountsEstimated: false,
    }
  }

  const list = consolidate(recipes, portions)
  return {
    list,
    shared: sharedAcrossMeals(list),
    waste: summariseWaste(list),
    amountsEstimated,
  }
}

/**
 * Load the signed-in household's current week plan and build its consolidated
 * shopping list. When `planId` is given the list is built from that exact plan
 * (the entry point from the week view); otherwise the household's most recent
 * plan is used (the Shopping tab's own entry point).
 *
 * Server-only: every server-only module is dynamically imported inside the
 * handler so none of it leaks into the client bundle (the week-server pattern).
 */
export const loadShoppingList = createServerFn({ method: 'GET' })
  .inputValidator((data?: { planId?: string }) => data ?? {})
  .handler(async ({ data }): Promise<ShoppingListView> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, mealPlan, recipeSwipe } =
      await import('../db/schema')
    const { eq, and, inArray, desc } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({
        id: household.id,
        profile: household.profile,
        preferredLocale: household.preferredLocale,
        adults: household.adults,
        children: household.children,
      })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const portions: HouseholdPortions = {
      adults: hh.adults,
      children: hh.children,
    }

    // Resolve the plan: the requested one (scoped to this household so a
    // stranger's plan id can never be read), else the most recent.
    const planRows = data.planId
      ? await db
          .select({
            id: mealPlan.id,
            weekStart: mealPlan.weekStart,
            plan: mealPlan.plan,
          })
          .from(mealPlan)
          .where(
            and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)),
          )
          .limit(1)
      : await db
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
    if (!current) {
      const empty = emptyList()
      return {
        planId: null,
        missingPlanId: data.planId ?? null,
        weekStart: null,
        portions,
        list: empty,
        shared: [],
        waste: summariseWaste(empty),
        amountsEstimated: false,
      }
    }

    const { hasImage } = await import('../db/recipe-filters')
    const { healPlanDays, persistHealedPlanIfChanged } =
      await import('./heal/heal-servable-plan')
    const { normalizeLocale } = await import('./locale-pref-server')

    const locale = normalizeLocale(hh.preferredLocale) ?? 'en'

    const catalogueRows = await db
      .select({
        id: recipe.id,
        title: recipe.title,
        titleEn: recipe.titleEn,
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
      title: pickTitle(r.title, r.titleEn, locale),
      cuisine: r.cuisine,
      category: r.category,
      dietaryTags: r.dietaryTags,
      ingredients: r.ingredients.map((i) => ({ name: i.name })),
      calories: r.calories,
      protein: r.protein,
      prepMinutes: r.prepMinutes,
      mealType: r.mealType,
    }))

    const onboardingSwipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    const { loadPlannerSignals } = await import('./planner-signals')
    const { swipes, penalties } = await loadPlannerSignals(
      hh.id,
      onboardingSwipes,
    )

    const servableIds = new Set(catalogueRows.map((r) => r.id))
    const { days: healedDays, changed: planChanged } = healPlanDays({
      days: current.plan.days,
      servableIds,
      catalogue,
      profile: hh.profile,
      swipes,
      penalties,
    })

    const planId = await persistHealedPlanIfChanged(
      db,
      hh.id,
      current,
      healedDays,
      planChanged,
    )

    const ids = healedDays
      .map((d) => d.recipeRef)
      .filter((r): r is string => !!r)

    const recipeRows = ids.length
      ? await db
          .select({
            id: recipe.id,
            title: recipe.title,
            titleEn: recipe.titleEn,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            ingredientsEn: recipe.ingredientsEn,
            quantitiesEstimated: recipe.quantitiesEstimated,
          })
          .from(recipe)
          .where(inArray(recipe.id, ids))
      : []

    // Default the shopping ingredient names to English (Dutch fallback) so the
    // demo list reads in English; quantities are language-agnostic (#295).
    const recipesById = new Map<string, PlanRecipe>(
      recipeRows.map((r) => [
        r.id,
        {
          id: r.id,
          title: pickTitle(r.title, r.titleEn),
          servings: r.servings,
          ingredients: pickIngredients(r.ingredients, r.ingredientsEn),
          quantitiesEstimated: r.quantitiesEstimated,
        },
      ]),
    )

    const { list, shared, waste, amountsEstimated } = deriveShoppingView(
      healedDays,
      recipesById,
      portions,
    )

    return {
      planId,
      missingPlanId: null,
      weekStart: current.weekStart,
      portions,
      list,
      shared,
      waste,
      amountsEstimated,
    }
  })

export interface ShoppingBootstrap {
  view: ShoppingListView
  staples: Array<StapleLine>
  frequentlyBought: Array<FrequentStaple>
  items: Array<ShoppingItem>
  preferredStore: StoreSlug
}

/**
 * The /shopping loader, batched into ONE round-trip (#251). The route fans the
 * reads (loadShoppingList + loadStaples + frequentlyBoughtStaples + getStore)
 * into one server handler instead of separate GET server fns per visit.
 *
 * The cart is NEVER auto-seeded from the week. Ingredients land on the saved
 * list ONLY when the user taps "Add to shopping list" on the week view, so an
 * explicit "Clear all" stays cleared and nothing the user did not ask for ever
 * appears in their cart. The loader still tops up blank amounts on existing
 * recipe rows (#292) — a backfill that never inserts a new row — so a list saved
 * before the Dutch-qty split gets its amounts without a clear + re-add.
 */
export const loadShoppingBootstrap = createServerFn({ method: 'GET' })
  .inputValidator((d?: { planId?: string }) => d ?? {})
  .handler(async ({ data }): Promise<ShoppingBootstrap> => {
    // DEMO data mode: return the canned cart (the merged ingredients of the demo
    // week) with no staples/extras, so a pitch account renders the polished list
    // without a seeded plan. The UI is unchanged; only the data swaps (#demo).
    {
      const { getSessionUser } = await import('./server-auth')
      const user = await getSessionUser()
      if (!user) throw new Error('Not signed in')
      const { getDb } = await import('../db/client')
      const { household } = await import('../db/schema')
      const { eq } = await import('drizzle-orm')
      const { resolveDataMode } = await import('./data-mode-resolve')
      const db = await getDb()
      const hh = (
        await db
          .select({
            id: household.id,
            adults: household.adults,
            children: household.children,
          })
          .from(household)
          .where(eq(household.ownerId, user.id))
          .limit(1)
      )[0]
      if (hh && (await resolveDataMode(db, hh.id)) === 'demo') {
        const { demoShoppingItems } = await import('./demo/fixtures')
        const empty = emptyList()
        return {
          view: {
            planId: 'demo-plan',
            missingPlanId: null,
            weekStart: null,
            portions: { adults: hh.adults, children: hh.children },
            list: empty,
            shared: [],
            waste: summariseWaste(empty),
            amountsEstimated: false,
          },
          staples: [],
          frequentlyBought: [],
          items: demoShoppingItems(),
          preferredStore: 'ah',
        }
      }
    }

    const { loadStaples, frequentlyBoughtStaples } =
      await import('./staples-server')
    const { backfillShoppingAmounts } = await import('./shopping-list-server')
    const { getStore } = await import('./store-pref-server')

    const planArg = data.planId ? { planId: data.planId } : {}
    const [view, staplesRes, frequentRes, preferredStore] = await Promise.all([
      loadShoppingList({ data: planArg }),
      loadStaples(),
      frequentlyBoughtStaples(),
      getStore(),
    ])

    // A deep-link to someone else's plan id must not show this household's stale
    // saved list as if it were that week (#plan-cart-mismatch). Return an empty
    // cart (staples still load so a top-up shop without a plan still works).
    if (view.missingPlanId) {
      return {
        view,
        staples: staplesRes.staples,
        frequentlyBought: frequentRes.items,
        items: [],
        preferredStore,
      }
    }

    // Never auto-seed: the saved list is the single source of truth, filled only
    // by the week view's "Add to shopping list". We still top up any stale recipe
    // rows whose amount was dropped before the Dutch-qty split shipped (#243),
    // matched against the current week, without clobbering user-typed amounts
    // (#292). backfillShoppingAmounts never inserts a row and returns the current
    // persisted list (a no-op cheap read when nothing is stale).
    const { items } = await backfillShoppingAmounts({ data: planArg })

    return {
      view,
      staples: staplesRes.staples,
      frequentlyBought: frequentRes.items,
      items,
      preferredStore,
    }
  })
