import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { deriveBadges } from './badges'
import type { Badge } from './badges'
import type { AdaptiveWeights } from './recsys/types'

/** Who can see the admin console. */
const ADMIN_EMAILS = ['tech@discopenguin.com']

async function adminUser() {
  const { getSessionUser } = await import('./server-auth')
  const u = await getSessionUser()
  return u && ADMIN_EMAILS.includes(u.email) ? u : null
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
