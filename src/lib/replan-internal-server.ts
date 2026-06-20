import type { LanguageModel } from 'ai'
import type { PlannedWeek } from './planner/types'
import type { ReplanResponse } from './replan-server'

/**
 * Replan a household's most-recent week from a plain-language instruction, with
 * no request cookie (the VAPI tool webhook is server-to-server). Mirrors
 * `replanWeek` but takes a server-verified `householdId` and targets the newest
 * plan. Returns null if the household has no plan.
 *
 * Server-only, and deliberately NOT in `replan-server.ts`: that module is
 * imported by the client week view (for the `replanWeek` createServerFn), so a
 * plain exported function there that reaches `readEnv` -> `cloudflare:workers`
 * would leak into the client bundle. Only the tool dispatch (server) imports this.
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

  const { deps: aiDeps } = await buildAiDeps()
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

/** Build the AI fallback deps (OpenAI gated on OPENAI_API_KEY via readEnv). With
 * no key the engine degrades to deterministic set-maths. Server-only. */
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
