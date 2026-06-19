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

/** Registry key of the live recommender. The current benchmark winner. */
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
