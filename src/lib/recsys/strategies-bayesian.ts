import type { InferredTaste, RecipeLite, Recommender, Swipe } from './types'

/**
 * Bayesian preference elicitation (Nicolas's idea).
 *
 * Each recipe is a sparse feature vector x. The household has a latent preference
 * vector theta in the same space. A swipe is modelled as a Bernoulli draw with
 * p(like) = sigmoid(theta . x). We do sequential Bayesian updating over theta with
 * a Gaussian prior (a diagonal Laplace approximation: online logistic regression
 * with an L2 penalty from the prior). The posterior MEAN of theta is the taste
 * estimate; ranking the catalogue by theta . x gives the recommendations.
 *
 * Why this and not the existing Adaptive set-maths ranker: Adaptive reads cuisine
 * net-preference plus a confident-ingredient adjustment with hand-tuned weights.
 * The Bayesian model instead LEARNS a weight per feature jointly from every swipe,
 * with a prior that keeps unseen features near zero and shrinks noisy ones. It is
 * the natural "let the data set the weights" counterpart to the hand-weighted
 * Adaptive ranker, and it slots into the same registry seam.
 *
 * Feature space (per #38's findings):
 *   - cuisine-group token (sparse + multi-spelled raw cuisine, so we collapse it
 *     to a coarse group; still the dominant axis).
 *   - distinctive ingredient tokens (common staples gated out by document frequency).
 *   - dietary-tag tokens.
 *   - a calories bucket token (light / mid / hearty).
 * Protein is deliberately NOT a feature: only 11/1531 recipes carry it, so it is
 * unusable signal. A bias term anchors the base like-rate.
 *
 * Determinism: there is no randomness in the update (the posterior is a closed-form
 * online Newton step over a fixed feature map). The seed is accepted for interface
 * parity with the other strategies and threads into the (unbiased, uniform) deck.
 *
 * OUT of scope (follow-up): using the posterior COVARIANCE to drive the next deck
 * (active learning / D-optimal swipe selection). Here the deck stays uniform, in
 * line with the prior benchmark finding that clever decks bias the per-cuisine read.
 */

/** Deterministic PRNG so the deck is reproducible (mirrors strategies.ts). */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sigmoid(z: number): number {
  // Numerically-stable logistic.
  if (z >= 0) {
    const e = Math.exp(-z)
    return 1 / (1 + e)
  }
  const e = Math.exp(z)
  return e / (1 + e)
}

/**
 * Collapse a raw, multi-spelled cuisine string to a coarse group token. Raw cuisine
 * is sparse and inconsistently spelled (#38), so a per-recipe raw-cuisine feature
 * would barely ever match across recipes. Grouping by keyword keeps cuisine as the
 * dominant axis while letting the weight generalise across spellings.
 */
function cuisineGroup(cuisine: string | null): string | null {
  if (!cuisine) return null
  const c = cuisine.toLowerCase()
  const has = (...keys: Array<string>) => keys.some((k) => c.includes(k))
  if (has('ital', 'pasta', 'pizza')) return 'italian'
  if (has('mexic', 'tex', 'taco', 'burrito')) return 'mexican'
  if (has('thai', 'viet', 'asian', 'chin', 'japan', 'korea', 'sushi', 'ramen'))
    return 'asian'
  if (has('indi', 'curry', 'pakist')) return 'indian'
  if (has('french', 'mediter', 'greek', 'spanish', 'tuscan'))
    return 'mediterranean'
  if (has('american', 'bbq', 'burger', 'southern')) return 'american'
  if (has('middle', 'lebanese', 'turkish', 'moroc', 'persian'))
    return 'middleeast'
  return 'other'
}

function caloriesBucket(calories: number | null | undefined): string | null {
  if (calories == null || calories <= 0) return null
  if (calories <= 450) return 'light'
  if (calories >= 650) return 'hearty'
  return 'mid'
}

/**
 * Bayesian recommender. Holds the document-frequency gate (so common ingredient
 * tokens are dropped from the feature map) and builds a sparse feature vector per
 * recipe. The posterior over theta is recomputed from the full swipe history on
 * each call (cheap: history is at most a few dozen swipes), so the API stays the
 * pure swipes -> ranking shape the other recommenders use.
 */
export class BayesianRecommender implements Recommender {
  readonly name = 'bayesian'
  private byId = new Map<string, RecipeLite>()
  private rng: () => number
  private df = new Map<string, number>()
  private commonCutoff: number
  /** Cached feature vector per recipe id (built once over the catalogue). */
  private feats = new Map<string, Map<string, number>>()
  /** Prior precision (inverse variance) of the Gaussian prior on theta. */
  private readonly priorPrecision: number
  /** Newton steps per fit. A handful converges for this well-conditioned problem. */
  private readonly steps = 8

  constructor(
    private recipes: Array<RecipeLite>,
    seed = 42,
    opts: { idfGate?: number; priorPrecision?: number } = {},
  ) {
    const idfGate = opts.idfGate ?? 0.12
    this.priorPrecision = opts.priorPrecision ?? 1
    this.rng = mulberry32(seed)
    for (const r of recipes) this.byId.set(r.id, r)
    // Document frequency over distinctive ingredient tokens, to drop staples.
    for (const r of recipes)
      for (const t of this.ingTokens(r))
        this.df.set(t, (this.df.get(t) ?? 0) + 1)
    this.commonCutoff = recipes.length * idfGate
    for (const r of recipes) this.feats.set(r.id, this.buildFeatures(r))
  }

  private ingTokens(r: RecipeLite): Set<string> {
    return new Set(
      r.ingredients.flatMap((i) =>
        i.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2),
      ),
    )
  }

  /**
   * Sparse feature map for a recipe. Bias term is always 1 (anchors the base
   * like-rate). Cuisine-group, dietary, and calories-bucket are one-hot; distinctive
   * ingredients each contribute a unit feature. Cuisine carries a larger magnitude
   * so it dominates, mirroring the rest of the recsys (cuisine is the strongest
   * true taste signal).
   */
  private buildFeatures(r: RecipeLite): Map<string, number> {
    const f = new Map<string, number>()
    f.set('__bias__', 1)
    const cg = cuisineGroup(r.cuisine)
    if (cg) f.set(`cuisine:${cg}`, 2)
    for (const d of r.dietaryTags) f.set(`diet:${d.toLowerCase()}`, 1)
    const cb = caloriesBucket(r.calories)
    if (cb) f.set(`cal:${cb}`, 1)
    for (const t of this.ingTokens(r)) {
      if ((this.df.get(t) ?? 0) < this.commonCutoff) f.set(`ing:${t}`, 1)
    }
    return f
  }

  private features(id: string): Map<string, number> {
    return this.feats.get(id) ?? new Map([['__bias__', 1]])
  }

  /**
   * Fit the posterior MEAN of theta from the swipe history by online logistic
   * regression with a Gaussian prior. We run a few Newton (IRLS) steps with a
   * diagonal approximation to the Hessian: this is the Laplace approximation's mean,
   * and the diagonal keeps it O(features) per step rather than O(features^2). The
   * prior precision adds an L2 penalty that pulls every weight toward zero, so
   * unseen features stay at 0 and the fit is well-posed even after one swipe.
   */
  private fit(swipes: Array<Swipe>): Map<string, number> {
    const theta = new Map<string, number>()
    // Pre-resolve the labelled feature vectors once.
    const data: Array<{ x: Map<string, number>; y: number }> = []
    for (const s of swipes) {
      if (!this.byId.has(s.recipeId)) continue
      data.push({ x: this.features(s.recipeId), y: s.like ? 1 : 0 })
    }
    if (data.length === 0) return theta

    for (let step = 0; step < this.steps; step++) {
      // Diagonal Newton: per-feature gradient g and curvature h.
      const grad = new Map<string, number>()
      const curv = new Map<string, number>()
      for (const { x, y } of data) {
        let z = 0
        for (const [k, v] of x) z += (theta.get(k) ?? 0) * v
        const p = sigmoid(z)
        const err = p - y
        const w = Math.max(p * (1 - p), 1e-6)
        for (const [k, v] of x) {
          grad.set(k, (grad.get(k) ?? 0) + err * v)
          curv.set(k, (curv.get(k) ?? 0) + w * v * v)
        }
      }
      // Apply the Gaussian prior (L2) to every feature the model knows about, plus
      // any feature touched this step. The bias is left unpenalised so the base
      // like-rate is free.
      const keys = new Set<string>([...theta.keys(), ...grad.keys()])
      for (const k of keys) {
        const t = theta.get(k) ?? 0
        const penalise = k !== '__bias__' ? this.priorPrecision : 0
        const g = (grad.get(k) ?? 0) + penalise * t
        const h = (curv.get(k) ?? 0) + penalise + 1e-6
        theta.set(k, t - g / h)
      }
    }
    return theta
  }

  /** Posterior-mean utility of a recipe: theta . x. */
  private utility(id: string, theta: Map<string, number>): number {
    let z = 0
    for (const [k, v] of this.features(id)) z += (theta.get(k) ?? 0) * v
    return z
  }

  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const theta = this.fit(swipes)
    return [...this.recipes]
      .map((r) => ({ r, s: this.utility(r.id, theta) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }

  /**
   * Deck: first round one-per-cuisine-group so the loved cuisine surfaces early,
   * then uniform random (the unbiased read). Active-learning by posterior covariance
   * is the deferred follow-up; the uniform deck matches the prior benchmark finding.
   */
  nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite> {
    const seen = new Set(swipes.map((s) => s.recipeId))
    const pool = this.recipes.filter((r) => !seen.has(r.id))
    if (swipes.length === 0) {
      const out: Array<RecipeLite> = []
      const used = new Set<string>()
      for (const r of pool) {
        if (out.length >= k) break
        const g = cuisineGroup(r.cuisine) ?? '?'
        if (!used.has(g)) {
          out.push(r)
          used.add(g)
        }
      }
      for (const r of pool) {
        if (out.length >= k) break
        if (!out.includes(r)) out.push(r)
      }
      return out.slice(0, k)
    }
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    return shuffled.slice(0, k)
  }

  /**
   * Human-readable taste read from the fitted posterior. Top positive cuisine-group
   * weights are "loved", negatives "disliked"; same for distinctive ingredients.
   * This drives the profile badges, like the other recommenders' explain().
   */
  explain(swipes: Array<Swipe>): InferredTaste {
    const theta = this.fit(swipes)
    const cuisines: Array<{ cuisine: string; weight: number }> = []
    const disCuisines: Array<string> = []
    const lovedIng: Array<[string, number]> = []
    const disIng: Array<[string, number]> = []
    for (const [k, w] of theta) {
      if (k.startsWith('cuisine:')) {
        const c = k.slice('cuisine:'.length)
        if (w > 0) cuisines.push({ cuisine: c, weight: w })
        else if (w < 0) disCuisines.push(c)
      } else if (k.startsWith('ing:')) {
        const t = k.slice('ing:'.length)
        if (w > 0) lovedIng.push([t, w])
        else if (w < 0) disIng.push([t, w])
      }
    }
    cuisines.sort((a, b) => b.weight - a.weight)
    lovedIng.sort((a, b) => b[1] - a[1])
    disIng.sort((a, b) => a[1] - b[1])
    const vegW = theta.get('diet:vegetarian') ?? 0
    return {
      lovedCuisines: cuisines,
      dislikedCuisines: disCuisines,
      lovedIngredients: lovedIng.slice(0, 8).map(([t]) => t),
      dislikedIngredients: disIng.slice(0, 8).map(([t]) => t),
      vegetarianLikelihood: sigmoid(vegW),
    }
  }
}
