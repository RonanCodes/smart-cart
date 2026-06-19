/**
 * Pluggable algorithm registry. Each recommender registers under a stable string
 * key; consumers (onboarding, planner, benchmark, the admin console) select an
 * algorithm by key rather than importing a concrete class. This is the seam that
 * lets the admin console switch the live algorithm and tune the Adaptive weights,
 * and lets a future Bayesian ranker drop in under a new key without touching any
 * call site.
 *
 * `makeRecommender(key, weights?)` is the single factory. For `adaptive`, the
 * optional weights override the tuning constants; omit them to reproduce TODAY's
 * behaviour exactly (the defaults live in config.ts and keep the benchmark guard
 * green).
 */
import type { AdaptiveWeights, RecipeLite, Recommender } from './types'
import {
  AdaptiveRecommender,
  HybridRecommender,
  MathsRecommender,
  RandomRecommender,
  VectorRecommender,
} from './strategies'
import { BayesianRecommender } from './strategies-bayesian'
import { DEFAULT_ADAPTIVE_WEIGHTS } from './config'

/** A factory that builds a recommender over a catalogue, with an optional seed. */
export type RecommenderFactory = (
  recipes: Array<RecipeLite>,
  seed?: number,
  weights?: AdaptiveWeights,
) => Recommender

/**
 * The registry: key -> factory. The Adaptive factory threads the optional weights
 * through; the others ignore them (they have no tunable constants yet). Keeping the
 * weights argument on every factory means `makeRecommender` has one uniform shape.
 */
export const REGISTRY: Record<string, RecommenderFactory> = {
  random: (recipes, seed) => new RandomRecommender(recipes, seed),
  maths: (recipes, seed) => new MathsRecommender(recipes, seed),
  vector: (recipes, seed) => new VectorRecommender(recipes, seed),
  hybrid: (recipes, seed) => new HybridRecommender(recipes, seed),
  adaptive: (recipes, seed, weights = DEFAULT_ADAPTIVE_WEIGHTS) =>
    new AdaptiveRecommender(recipes, seed, weights),
  // Bayesian: online logistic regression with a Gaussian prior over a latent taste
  // vector. Drops in under its own key; no call site changes. The `weights` arg is
  // Adaptive-only, so Bayesian ignores it (it learns its own per-feature weights).
  bayesian: (recipes, seed) => new BayesianRecommender(recipes, seed),
}

/** Every registered algorithm key, in registration order. */
export function registeredKeys(): Array<string> {
  return Object.keys(REGISTRY)
}

/** True if `key` names a registered algorithm. */
export function isRegistered(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, key)
}

/**
 * Build a recommender by key. Throws on an unknown key (a programming error: keys
 * come from config or a validated admin input, never raw user text). `weights`
 * only affects the `adaptive` algorithm; other keys ignore it.
 */
export function makeRecommender(
  key: string,
  recipes: Array<RecipeLite>,
  seed?: number,
  weights?: AdaptiveWeights,
): Recommender {
  const factory = REGISTRY[key]
  if (!factory) {
    throw new Error(
      `Unknown recommender key "${key}". Registered: ${registeredKeys().join(', ')}`,
    )
  }
  return factory(recipes, seed, weights)
}
