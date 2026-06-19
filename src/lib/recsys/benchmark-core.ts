/**
 * The shared benchmark computation. Both the benchmark script (scripts/benchmark.ts)
 * and the regression-gate test (benchmark.guard.test.ts) call runBenchmark() so they
 * compute "the benchmark" exactly the same way. It is pure and deterministic: given
 * the frozen fixture (recipes + synthetic users) it simulates the swipe onboarding for
 * every recommender and returns recall@TOP_N at each swipe checkpoint plus the median
 * swipes-to-target. No DB, no network, no Math.random (recommenders use a seeded PRNG).
 *
 * Node-only at the call sites because the fixture is read from disk via fixture.ts, but
 * this module itself only touches in-memory data, so it is safe to unit-test.
 */
import type {
  AdaptiveWeights,
  RecipeLite,
  Recommender,
  Swipe,
  UserProfile,
} from './types'
import { makeRecommender, registeredKeys } from './registry'
import { simulateSwipe, trueTopN } from './ground-truth'

/** One recommender per registered algorithm key, in registration order. */
function allRecommenders(recipes: Array<RecipeLite>): Array<Recommender> {
  return registeredKeys().map((key) => makeRecommender(key, recipes))
}

export const DECK = 5
export const CHECKPOINTS = [5, 10, 15, 20, 25, 30] as const
export const MAX: number = CHECKPOINTS[CHECKPOINTS.length - 1]!
export const TOP_N = 20
/** Recall threshold the "median swipes to target" headline measures against. */
export const TARGET_RECALL = 0.6

export interface AlgoResult {
  /** recall@TOP_N at each checkpoint (0..1), keyed by swipe count. */
  recallByCheckpoint: Record<number, number>
  /** Median swipes to reach TARGET_RECALL, or null if no user reached it. */
  medianSwipesToTarget: number | null
  /** Fraction of scored users that reached TARGET_RECALL within MAX swipes. */
  pctReachedTarget: number
}

export interface BenchmarkResult {
  /** Number of synthetic users that had a non-empty true top-N (scored). */
  usersScored: number
  /** Per-algorithm aggregates, keyed by recommender name. */
  summary: Record<string, AlgoResult>
}

function recall(got: Array<RecipeLite>, truth: Array<string>): number {
  if (truth.length === 0) return 1
  const t = new Set(truth)
  const hit = got.filter((r) => t.has(r.id)).length
  return hit / Math.min(truth.length, TOP_N)
}

function median(a: Array<number>): number {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)] ?? 0
}

/**
 * Run the full benchmark over a fixture. Deterministic: same inputs -> same numbers.
 */
export function runBenchmark(
  recipes: Array<RecipeLite>,
  users: Array<UserProfile>,
): BenchmarkResult {
  const names = allRecommenders(recipes).map((r) => r.name)

  const recallSum = new Map<string, Map<number, number>>()
  const swipesToTarget = new Map<string, Array<number>>()
  for (const n of names) {
    recallSum.set(n, new Map(CHECKPOINTS.map((c) => [c, 0])))
    swipesToTarget.set(n, [])
  }

  let usersScored = 0
  for (const user of users) {
    const truth = trueTopN(user, recipes, TOP_N)
    if (truth.length === 0) continue
    usersScored++
    for (const rec of allRecommenders(recipes)) {
      const swipes: Array<Swipe> = []
      let reached = MAX + 1
      while (swipes.length < MAX) {
        const deck = rec.nextDeck(swipes, Math.min(DECK, MAX - swipes.length))
        if (deck.length === 0) break
        for (const r of deck)
          swipes.push({ recipeId: r.id, like: simulateSwipe(user, r) })
        const count = swipes.length
        if ((CHECKPOINTS as ReadonlyArray<number>).includes(count)) {
          const r = recall(rec.recommend(swipes, TOP_N), truth)
          recallSum
            .get(rec.name)!
            .set(count, recallSum.get(rec.name)!.get(count)! + r)
          if (r >= TARGET_RECALL && reached > MAX) reached = count
        }
      }
      swipesToTarget.get(rec.name)!.push(reached)
    }
  }

  const summary: Record<string, AlgoResult> = {}
  const used = Math.max(usersScored, 1)
  for (const n of names) {
    const reachedList = swipesToTarget.get(n)!.filter((x) => x <= MAX)
    summary[n] = {
      recallByCheckpoint: Object.fromEntries(
        CHECKPOINTS.map((c) => [c, recallSum.get(n)!.get(c)! / used]),
      ),
      medianSwipesToTarget: reachedList.length ? median(reachedList) : null,
      pctReachedTarget: reachedList.length / used,
    }
  }

  return { usersScored, summary }
}

/** Options for the fast, single-algorithm runner the admin console drives. */
export interface SingleRunOptions {
  /** Checkpoints (swipe counts) to record recall at. Defaults to CHECKPOINTS. */
  checkpoints?: ReadonlyArray<number>
  /**
   * Cap on how many synthetic users to simulate. The first `userLimit` users with
   * a non-empty true top-N are used. Smaller = faster; the admin console passes a
   * small value (e.g. 40) so a run returns in a couple of seconds rather than ~60s.
   */
  userLimit?: number
  /** Custom Adaptive weights. Only affects the `adaptive` algorithm. */
  weights?: AdaptiveWeights
  /** Seed for the recommender PRNG. Fixed seed keeps a run deterministic. */
  seed?: number
}

export interface SingleRunResult {
  /** The algorithm key that was run. */
  key: string
  /** The recommender's human-readable name. */
  name: string
  /** recall@TOP_N at each requested checkpoint (0..1), keyed by swipe count. */
  recallByCheckpoint: Record<number, number>
  /** Median swipes to reach TARGET_RECALL, or null if no sampled user reached it. */
  medianSwipesToTarget: number | null
  /** Fraction of sampled users that reached TARGET_RECALL within the max checkpoint. */
  pctReachedTarget: number
  /** How many users were actually scored in this (sub-sampled) run. */
  usersScored: number
}

/**
 * Run ONE algorithm over a (sub-sampled) fixture, fast, with optional custom weights.
 *
 * This is the admin-console / interactive path: pick an algorithm key, optionally
 * override the Adaptive weights, and get its recall back in a couple of seconds by
 * scoring only the first `userLimit` users up to the largest requested checkpoint.
 * Deterministic (seeded PRNG, deterministic user order), pure, no DB / network, so it
 * is safe to unit-test and to call from a server fn. The full `runBenchmark` above is
 * untouched, so the committed baseline + regression guard stay exactly as frozen.
 */
export function runSingleAlgorithm(
  recipes: Array<RecipeLite>,
  users: Array<UserProfile>,
  key: string,
  options: SingleRunOptions = {},
): SingleRunResult {
  const checkpoints = options.checkpoints ?? CHECKPOINTS
  const maxSwipes = Math.max(...checkpoints)
  const userLimit = options.userLimit ?? users.length
  const rec = makeRecommender(key, recipes, options.seed, options.weights)

  const recallSum = new Map<number, number>(checkpoints.map((c) => [c, 0]))
  const reachedList: Array<number> = []
  let usersScored = 0

  for (const user of users) {
    if (usersScored >= userLimit) break
    const truth = trueTopN(user, recipes, TOP_N)
    if (truth.length === 0) continue
    usersScored++

    const swipes: Array<Swipe> = []
    let reached = maxSwipes + 1
    while (swipes.length < maxSwipes) {
      const deck = rec.nextDeck(
        swipes,
        Math.min(DECK, maxSwipes - swipes.length),
      )
      if (deck.length === 0) break
      for (const r of deck)
        swipes.push({ recipeId: r.id, like: simulateSwipe(user, r) })
      const count = swipes.length
      if (checkpoints.includes(count)) {
        const r = recall(rec.recommend(swipes, TOP_N), truth)
        recallSum.set(count, recallSum.get(count)! + r)
        if (r >= TARGET_RECALL && reached > maxSwipes) reached = count
      }
    }
    if (reached <= maxSwipes) reachedList.push(reached)
  }

  const used = Math.max(usersScored, 1)
  return {
    key,
    name: rec.name,
    recallByCheckpoint: Object.fromEntries(
      checkpoints.map((c) => [c, recallSum.get(c)! / used]),
    ),
    medianSwipesToTarget: reachedList.length ? median(reachedList) : null,
    pctReachedTarget: reachedList.length / used,
    usersScored,
  }
}
