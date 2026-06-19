export type {
  RecipeLite,
  Swipe,
  UserProfile,
  Recommender,
  InferredTaste,
  AdaptiveWeights,
  SoftScoreWeights,
} from './types'
export { Embedder, cosine } from './embedding'
export {
  RandomRecommender,
  MathsRecommender,
  VectorRecommender,
  HybridRecommender,
  AdaptiveRecommender,
  makeRecommenders,
} from './strategies'
export { BayesianRecommender } from './strategies-bayesian'
export {
  REGISTRY,
  makeRecommender,
  registeredKeys,
  isRegistered,
} from './registry'
export type { RecommenderFactory } from './registry'
export { DEFAULT_ALGORITHM, DEFAULT_ADAPTIVE_WEIGHTS } from './config'
export { trueScore, simulateSwipe, trueTopN } from './ground-truth'
