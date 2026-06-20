import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { deriveBadges } from './badges'
import type { Badge } from './badges'
import type { AdaptiveWeights, InferredTaste } from './recsys/types'
import type { FoldStats } from './recsys/feedback-fold'
import type { UserExplanation } from './recsys/explain-why'

/**
 * Who can see the admin console. The list is env-driven (comma-separated
 * ADMIN_EMAILS), so admins can be added/removed by setting a Worker secret
 * with no redeploy. The default owner (ADMIN_EMAIL) is always included, so the
 * console can never be locked out, and email matching is trim+lowercase
 * normalised (reusing the pure access-rules helpers).
 */
async function adminUser() {
  const { getSessionUser } = await import('./server-auth')
  const u = await getSessionUser()
  if (!u) return null
  const { readEnv } = await import('./env')
  const { parseApprovedList, isApprovedIn } = await import('./access-rules')
  const admins = parseApprovedList(await readEnv('ADMIN_EMAILS'))
  return isApprovedIn(u.email, admins) ? u : null
}

export const isAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => Boolean(await adminUser()),
)

/** beforeLoad guard for /admin: non-admins are bounced to the home page. */
export async function requireAdminBeforeLoad(): Promise<void> {
  if (!(await isAdmin())) throw redirect({ to: '/' })
}

export interface AdminUserRow {
  userId: string
  email: string
  householdId: string | null
  swipes: number
  badges: Array<Badge>
}

export const listUsers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AdminUserRow>> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe } = await import('../db/schema')
    const { eq, count } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({
        userId: user.id,
        email: user.email,
        householdId: household.id,
        profile: household.profile,
      })
      .from(user)
      .leftJoin(household, eq(household.ownerId, user.id))
    const counts = await db
      .select({ hid: recipeSwipe.householdId, n: count() })
      .from(recipeSwipe)
      .groupBy(recipeSwipe.householdId)
    const byHid = new Map(counts.map((c) => [c.hid, c.n]))
    return rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      householdId: r.householdId,
      swipes: r.householdId ? (byHid.get(r.householdId) ?? 0) : 0,
      badges: r.profile ? deriveBadges(r.profile) : [],
    }))
  },
)

// ---------------------------------------------------------------------------
// Waitlist console: list the marketing-landing signups (newest first) so the
// admin can see who joined and how many. Read-only; the waitlist table lives
// outside the main profile schema (src/db/waitlist-schema.ts).
// ---------------------------------------------------------------------------

/** One waitlist signup, shaped for the admin list. */
export interface WaitlistRowView {
  email: string
  /** ISO-8601 signup timestamp. */
  createdAt: string
}

export interface WaitlistView {
  count: number
  rows: Array<WaitlistRowView>
}

/**
 * Shape raw waitlist rows into the admin view: newest first, dates as ISO
 * strings, plus the total count. Pure so it can be unit-tested with a fixture.
 */
export function shapeWaitlist(
  rows: Array<{ email: string; createdAt: Date | string | number }>,
): WaitlistView {
  const view = rows
    .map((r) => ({
      email: r.email,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt).toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { count: view.length, rows: view }
}

export const listWaitlist = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WaitlistView> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { waitlist } = await import('../db/waitlist-schema')
    const db = await getDb()
    const rows = await db
      .select({ email: waitlist.email, createdAt: waitlist.createdAt })
      .from(waitlist)
    return shapeWaitlist(rows)
  },
)

export interface Datapoint {
  recipeTitle: string
  cuisine: string | null
  direction: string
  at: string
}
export interface UserDatapoints {
  email: string
  badges: Array<Badge>
  lovedTastes: Array<string>
  dislikes: Array<string>
  swipes: Array<Datapoint>
}

export const getUserDatapoints = createServerFn({ method: 'POST' })
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data }): Promise<UserDatapoints | null> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe, recipe } =
      await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()
    const u = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1)
    )[0]
    if (!u) return null
    const hh = (
      await db
        .select({ id: household.id, profile: household.profile })
        .from(household)
        .where(eq(household.ownerId, data.userId))
        .limit(1)
    )[0]
    const swipes = hh
      ? await db
          .select({
            recipeTitle: recipe.title,
            cuisine: recipe.cuisine,
            direction: recipeSwipe.direction,
            at: recipeSwipe.createdAt,
          })
          .from(recipeSwipe)
          .innerJoin(recipe, eq(recipe.id, recipeSwipe.recipeId))
          .where(eq(recipeSwipe.householdId, hh.id))
          .orderBy(desc(recipeSwipe.createdAt))
      : []
    const profile = hh?.profile
    return {
      email: u.email,
      badges: profile ? deriveBadges(profile) : [],
      lovedTastes: profile?.lovedTastes ?? [],
      dislikes: profile?.dislikes ?? [],
      swipes: swipes.map((s) => ({
        recipeTitle: s.recipeTitle,
        cuisine: s.cuisine,
        direction: s.direction,
        at: s.at instanceof Date ? s.at.toISOString() : String(s.at),
      })),
    }
  })

// ---------------------------------------------------------------------------
// Benchmark console: run the swipe benchmark over the FROZEN fixture on demand,
// switch algorithm, tune the Adaptive weights, compare against the committed
// baseline. All recsys + node-only (fixture-on-disk) code is pulled in via
// dynamic import() so it never leaks into the client bundle.
// ---------------------------------------------------------------------------

/** A single baselined algorithm row (mirrors docs/benchmarks/baseline.json). */
export interface BaselineAlgo {
  recallByCheckpoint: Record<string, number>
  medianSwipesToTarget: number | null
}

/** What the Benchmark tab needs to render its controls before any run. */
export interface BenchmarkMeta {
  /** Registered algorithm keys, in registration order (auto-includes new strategies). */
  algorithms: Array<string>
  /** The live default algorithm key. */
  defaultAlgorithm: string
  /** The default Adaptive weights, used to seed the numeric inputs. */
  defaultWeights: AdaptiveWeights
  /** The committed baseline: recall@checkpoint per algorithm + the checkpoints + metric. */
  baseline: {
    metric: string
    checkpoints: Array<number>
    algorithms: Record<string, BaselineAlgo>
  }
}

export const getBenchmarkMeta = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BenchmarkMeta> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { registeredKeys } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM, DEFAULT_ADAPTIVE_WEIGHTS } =
      await import('./recsys/config')
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const baselineRaw = JSON.parse(
      readFileSync(
        join(process.cwd(), 'docs', 'benchmarks', 'baseline.json'),
        'utf8',
      ),
    ) as {
      metric: string
      checkpoints: Array<number>
      algorithms: Record<string, BaselineAlgo>
    }
    return {
      algorithms: registeredKeys(),
      defaultAlgorithm: DEFAULT_ALGORITHM,
      defaultWeights: DEFAULT_ADAPTIVE_WEIGHTS,
      baseline: {
        metric: baselineRaw.metric,
        checkpoints: baselineRaw.checkpoints,
        algorithms: baselineRaw.algorithms,
      },
    }
  },
)

/** Input for a single fast benchmark run. */
export interface RunBenchmarkInput {
  /** Registered algorithm key to run. */
  algorithm: string
  /** Optional Adaptive weight overrides (only affects the `adaptive` algorithm). */
  weights?: AdaptiveWeights
  /** How many synthetic users to sample. Capped server-side so a run stays fast. */
  userLimit?: number
}

export interface RunBenchmarkResult {
  key: string
  name: string
  recallByCheckpoint: Record<number, number>
  medianSwipesToTarget: number | null
  pctReachedTarget: number
  usersScored: number
  /** Checkpoints actually measured (aligned to the baseline's checkpoints). */
  checkpoints: Array<number>
  /** Wall-clock duration of the run in milliseconds. */
  ranMs: number
}

/**
 * Run ONE algorithm over a sub-sample of the frozen fixture, fast. The user limit is
 * clamped to [10, 80] so an admin can never trigger a 60s full run from the browser:
 * the fast path scores a few dozen users up to the baseline's largest checkpoint and
 * returns in a couple of seconds. Deterministic (seeded), no DB, no network.
 */
export const runBenchmarkFast = createServerFn({ method: 'POST' })
  .inputValidator((d: RunBenchmarkInput) => d)
  .handler(async ({ data }): Promise<RunBenchmarkResult> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { isRegistered } = await import('./recsys/registry')
    if (!isRegistered(data.algorithm)) {
      throw new Error(`Unknown algorithm "${data.algorithm}"`)
    }
    const { loadBenchmarkFixture } = await import('./recsys/fixture')
    const { runSingleAlgorithm } = await import('./recsys/benchmark-core')
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const baseline = JSON.parse(
      readFileSync(
        join(process.cwd(), 'docs', 'benchmarks', 'baseline.json'),
        'utf8',
      ),
    ) as { checkpoints: Array<number> }
    const checkpoints = baseline.checkpoints
    const userLimit = Math.min(80, Math.max(10, data.userLimit ?? 40))

    const { recipes, users } = loadBenchmarkFixture()
    const started = Date.now()
    const result = runSingleAlgorithm(recipes, users, data.algorithm, {
      checkpoints,
      userLimit,
      weights: data.weights,
    })
    return {
      key: result.key,
      name: result.name,
      recallByCheckpoint: result.recallByCheckpoint,
      medianSwipesToTarget: result.medianSwipesToTarget,
      pctReachedTarget: result.pctReachedTarget,
      usersScored: result.usersScored,
      checkpoints,
      ranMs: Date.now() - started,
    }
  })

// ---------------------------------------------------------------------------
// Real-feedback fold-in: see a REAL household's ranking + inferred taste WITH
// vs WITHOUT its post-meal feedback folded on top of the onboarding swipes.
// The synthetic-fixture benchmark above stays the baseline; this is the
// on-top-of, live-data view. Real households are the ones that have actually
// left meal_feedback (only there does the toggle change anything).
// ---------------------------------------------------------------------------

/** A household the admin can run the with/without-feedback comparison on. */
export interface RealFeedbackHousehold {
  userId: string
  email: string
  householdId: string
  swipes: number
  feedback: number
}

/**
 * List households that have at least one post-meal feedback row. Those are the
 * only ones where folding real feedback changes the ranking, so the console
 * picker offers exactly them (synthetic seeded users have no meal_feedback).
 */
export const listRealFeedbackHouseholds = createServerFn({
  method: 'GET',
}).handler(async (): Promise<Array<RealFeedbackHousehold>> => {
  if (!(await adminUser())) throw new Error('forbidden')
  const { getDb } = await import('../db/client')
  const { user, household, recipeSwipe, mealFeedback } =
    await import('../db/schema')
  const { eq, count, inArray } = await import('drizzle-orm')
  const db = await getDb()

  const fbCounts = await db
    .select({ hid: mealFeedback.householdId, n: count() })
    .from(mealFeedback)
    .groupBy(mealFeedback.householdId)
  if (fbCounts.length === 0) return []
  const hids = fbCounts.map((c) => c.hid)
  const fbByHid = new Map(fbCounts.map((c) => [c.hid, c.n]))

  const rows = await db
    .select({
      householdId: household.id,
      userId: user.id,
      email: user.email,
    })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(inArray(household.id, hids))

  const swipeCounts = await db
    .select({ hid: recipeSwipe.householdId, n: count() })
    .from(recipeSwipe)
    .where(inArray(recipeSwipe.householdId, hids))
    .groupBy(recipeSwipe.householdId)
  const swByHid = new Map(swipeCounts.map((c) => [c.hid, c.n]))

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    householdId: r.householdId,
    swipes: swByHid.get(r.householdId) ?? 0,
    feedback: fbByHid.get(r.householdId) ?? 0,
  }))
})

/** One recommended recipe in a household-ranking comparison. */
export interface RankedRecipe {
  id: string
  title: string
  cuisine: string | null
}

/** A household's inferred taste + top recommendations under one observation set. */
export interface RankingView {
  taste: InferredTaste
  topRecipes: Array<RankedRecipe>
}

/** The with/without-feedback comparison for one real household. */
export interface RealFeedbackComparison {
  email: string
  householdId: string
  /** What folding the real feedback added over the onboarding swipes. */
  fold: FoldStats
  /** Ranking from onboarding swipes only (the baseline). */
  withoutFeedback: RankingView
  /** Ranking with post-meal feedback folded on top. Same when fold adds nothing. */
  withFeedback: RankingView
}

/** Input: which household, and how many top recipes to show. */
export interface CompareRealFeedbackInput {
  householdId: string
  topN?: number
}

/**
 * Rank a REAL household's catalogue twice — onboarding-only, then with its
 * post-meal feedback folded on top — and return both inferred tastes + top-N
 * recommendations so the console can show the effect side by side. Uses the live
 * default algorithm so the comparison matches what the planner actually does.
 * Pure recsys + node-only code is dynamically imported (no client-bundle leak).
 */
export const compareRealFeedback = createServerFn({ method: 'POST' })
  .inputValidator((d: CompareRealFeedbackInput) => d)
  .handler(async ({ data }): Promise<RealFeedbackComparison> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe, mealFeedback } =
      await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { foldRealFeedback, foldStats } =
      await import('./recsys/feedback-fold')
    const db = await getDb()

    const hh = (
      await db
        .select({ id: household.id, ownerId: household.ownerId })
        .from(household)
        .where(eq(household.id, data.householdId))
        .limit(1)
    )[0]
    if (!hh) throw new Error('household not found')
    const owner = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, hh.ownerId))
        .limit(1)
    )[0]

    const swipeRows = await db
      .select({
        recipeId: recipeSwipe.recipeId,
        direction: recipeSwipe.direction,
      })
      .from(recipeSwipe)
      .where(eq(recipeSwipe.householdId, hh.id))
    const onboardingSwipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    const fbRows = await db
      .select({
        recipeId: mealFeedback.recipeId,
        rating: mealFeedback.rating,
      })
      .from(mealFeedback)
      .where(eq(mealFeedback.householdId, hh.id))
      .orderBy(mealFeedback.createdAt)
    const feedback = fbRows
      .filter((f): f is { recipeId: string; rating: string } =>
        Boolean(f.recipeId),
      )
      .map((f) => ({ recipeId: f.recipeId, rating: f.rating }))

    const foldedSwipes = foldRealFeedback(onboardingSwipes, feedback)
    const fold = foldStats(onboardingSwipes, feedback)

    const { recipes } = await loadCatalogue()
    const topN = Math.min(20, Math.max(1, data.topN ?? 7))
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)

    const view = (swipes: typeof onboardingSwipes): RankingView => ({
      taste: rec.explain(swipes),
      topRecipes: rec.recommend(swipes, topN).map((r) => ({
        id: r.id,
        title: r.title,
        cuisine: r.cuisine,
      })),
    })

    return {
      email: owner?.email ?? '(unknown)',
      householdId: hh.id,
      fold,
      withoutFeedback: view(onboardingSwipes),
      withFeedback: view(foldedSwipes),
    }
  })

// ---------------------------------------------------------------------------
// Explainability: for ONE real user, show WHY recipes were chosen as a
// data-point graph — their swipes (data points) feed the inferred tastes which
// drive the top recommendations, and each recommendation carries the signals
// that placed it. Uses the live default algorithm so the explanation matches
// what the planner actually does. All recsys + node-only code is dynamically
// imported so it never leaks into the client bundle.
// ---------------------------------------------------------------------------

/** Re-export the shaped payload so the route + component import from one place. */
export type { UserExplanation } from './recsys/explain-why'
export type {
  RecipeWhy,
  WhySignal,
  WhyDatapoint,
  InferredPreference,
} from './recsys/explain-why'

/** Input: which user, and how many top recommendations to explain. */
export interface ExplainUserInput {
  userId: string
  topN?: number
}

export const explainUser = createServerFn({ method: 'POST' })
  .inputValidator((d: ExplainUserInput) => d)
  .handler(async ({ data }): Promise<UserExplanation | null> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe } = await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { recipeWhys, shapePreferences } =
      await import('./recsys/explain-why')
    const db = await getDb()

    const u = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1)
    )[0]
    if (!u) return null
    const hh = (
      await db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.ownerId, data.userId))
        .limit(1)
    )[0]

    const swipeRows = hh
      ? await db
          .select({
            recipeId: recipeSwipe.recipeId,
            direction: recipeSwipe.direction,
          })
          .from(recipeSwipe)
          .where(eq(recipeSwipe.householdId, hh.id))
          .orderBy(desc(recipeSwipe.createdAt))
      : []

    const swipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    const { recipes } = await loadCatalogue()
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const topN = Math.min(20, Math.max(1, data.topN ?? 8))
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)

    const taste = rec.explain(swipes)
    const likedRecipes = swipes
      .filter((s) => s.like)
      .map((s) => byId.get(s.recipeId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
    const topRecipes = rec.recommend(swipes, topN)

    const datapoints = swipes.map((s) => {
      const r = byId.get(s.recipeId)
      return {
        recipeTitle: r?.title ?? '(unknown recipe)',
        cuisine: r?.cuisine ?? null,
        like: s.like,
      }
    })

    return {
      email: u.email,
      datapoints,
      preferences: shapePreferences(taste, likedRecipes),
      recommendations: recipeWhys(topRecipes, taste),
    }
  })
