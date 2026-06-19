/**
 * Live recommender configuration: the default algorithm key and the default
 * Adaptive weights. This is the single place the production system reads from, so
 * switching the live algorithm or retuning the Adaptive ranker is a one-file change
 * (and, later, an admin-console write) rather than an edit scattered across the
 * onboarding, planner and benchmark call sites.
 *
 * The current default is the benchmark winner: `adaptive` at its frozen constants.
 * DEFAULT_ADAPTIVE_WEIGHTS reproduces TODAY's hard-coded literals exactly, so the
 * regression-guard test stays green. Change these deliberately and re-baseline.
 */
import type { AdaptiveWeights } from './types'

/**
 * Registry key of the live recommender. The current benchmark winner.
 *
 * Head-to-head on the frozen fixture v1 (300 users, recall@20): adaptive scores
 * 0.105 @20 / 0.161 @30; bayesian (online logistic + Gaussian prior, #41) scores
 * 0.088 @20 / 0.090 @30. Adaptive wins at every checkpoint, so it stays the live
 * default. The Bayesian ranker is registered and benchmarked but not promoted; the
 * likely lift (active-learning deck via posterior covariance) is a deferred
 * follow-up, OUT of scope for #41.
 */
export const DEFAULT_ALGORITHM = 'adaptive'

/**
 * Default Adaptive weights. Each value is the literal that used to be hard-coded
 * in strategies.ts / planner.ts. Do not change without re-running the benchmark
 * and refreshing docs/benchmarks/baseline.json.
 */
export const DEFAULT_ADAPTIVE_WEIGHTS: AdaptiveWeights = {
  idfGate: 0.12,
  dislikedCuisinePenalty: 1,
  ingredientMagnitude: 0.5,
  soft: {
    calorie: 0.3,
    protein: 0.2,
    prep: 0.2,
  },
}
