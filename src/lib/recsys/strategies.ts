import type { InferredTaste, RecipeLite, Recommender, Swipe } from './types'
import { Embedder, centroid, cosine } from './embedding'
import type { SparseVec } from './embedding'

/** Deterministic PRNG so the benchmark is reproducible (no Math.random). */
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

function attrsOf(r: RecipeLite): Array<string> {
  return [
    ...(r.cuisine ? [`c:${r.cuisine}`] : []),
    ...r.dietaryTags.map((d) => `d:${d}`),
    ...r.ingredients.flatMap((i) =>
      i.name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 2)
        .map((w) => `i:${w}`),
    ),
  ]
}

abstract class Base implements Recommender {
  abstract readonly name: string
  protected byId = new Map<string, RecipeLite>()
  protected rng: () => number
  /** Ingredient-token document frequency, to drop common tokens (sugar, onion). */
  protected df = new Map<string, number>()
  private commonCutoff: number
  constructor(
    protected recipes: Array<RecipeLite>,
    seed = 42,
  ) {
    for (const r of recipes) this.byId.set(r.id, r)
    for (const r of recipes)
      for (const t of this.ingTokens(r))
        this.df.set(t, (this.df.get(t) ?? 0) + 1)
    // A token is "distinctive" if it appears in fewer than 12% of recipes; common
    // staples (salt, onion, oil, sugar, even chicken) are not a learnable signal.
    this.commonCutoff = recipes.length * 0.12
    this.rng = mulberry32(seed)
  }

  protected ingTokens(r: RecipeLite): Set<string> {
    return new Set(
      r.ingredients.flatMap((i) =>
        i.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 2),
      ),
    )
  }
  protected distinctive(token: string): boolean {
    return (this.df.get(token) ?? 0) < this.commonCutoff
  }

  protected partition(swipes: Array<Swipe>) {
    const liked: Array<RecipeLite> = []
    const disliked: Array<RecipeLite> = []
    const seen = new Set<string>()
    for (const s of swipes) {
      seen.add(s.recipeId)
      const r = this.byId.get(s.recipeId)
      if (!r) continue
      ;(s.like ? liked : disliked).push(r)
    }
    return { liked, disliked, seen }
  }

  protected unseen(seen: Set<string>): Array<RecipeLite> {
    return this.recipes.filter((r) => !seen.has(r.id))
  }

  abstract nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite>
  abstract recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite>

  /** Model-light read of taste from swipes (used for badges + the admin viewer). */
  explain(swipes: Array<Swipe>): InferredTaste {
    const { liked, disliked } = this.partition(swipes)
    const cuisineScore = new Map<string, number>()
    for (const r of liked)
      if (r.cuisine)
        cuisineScore.set(r.cuisine, (cuisineScore.get(r.cuisine) ?? 0) + 1)
    for (const r of disliked)
      if (r.cuisine)
        cuisineScore.set(r.cuisine, (cuisineScore.get(r.cuisine) ?? 0) - 1)
    const loved = [...cuisineScore.entries()]
      .filter(([, w]) => w > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cuisine, weight]) => ({ cuisine, weight }))
    const dislikedCuisines = [...cuisineScore.entries()]
      .filter(([, w]) => w < 0)
      .map(([c]) => c)
    const likedTokenCount = new Map<string, number>()
    for (const r of liked)
      for (const t of this.ingTokens(r))
        likedTokenCount.set(t, (likedTokenCount.get(t) ?? 0) + 1)
    const disTokenCount = new Map<string, number>()
    for (const r of disliked)
      for (const t of this.ingTokens(r))
        disTokenCount.set(t, (disTokenCount.get(t) ?? 0) + 1)
    // Only distinctive (non-common) ingredients with clear, one-sided evidence.
    const dislikedIngredients = [...disTokenCount.entries()]
      .filter(
        ([t, c]) => c >= 2 && !likedTokenCount.has(t) && this.distinctive(t),
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t)
    const lovedIngredients = [...likedTokenCount.entries()]
      .filter(
        ([t, c]) =>
          c >= 2 && (disTokenCount.get(t) ?? 0) === 0 && this.distinctive(t),
      )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t)
    const vegLikes = liked.filter((r) =>
      r.dietaryTags.includes('vegetarian'),
    ).length
    return {
      lovedCuisines: loved,
      dislikedCuisines,
      lovedIngredients,
      dislikedIngredients,
      vegetarianLikelihood: liked.length ? vegLikes / liked.length : 0,
    }
  }
}

/** Baseline: random deck, recommend by liked-cuisine frequency. */
export class RandomRecommender extends Base {
  readonly name = 'random'
  nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite> {
    const pool = this.unseen(this.partition(swipes).seen)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    return pool.slice(0, k)
  }
  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const w = new Map(
      this.explain(swipes).lovedCuisines.map((c) => [c.cuisine, c.weight]),
    )
    return [...this.recipes]
      .map((r) => ({ r, s: w.get(r.cuisine ?? '') ?? 0 }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }
}

/**
 * Maths: an IDF-weighted attribute model. Cuisine dominates (it is the strongest
 * true signal), common ingredients (onion, oil) are near-zero weight via IDF, so
 * disliking a few recipes does not poison everything. Deck maximises cuisine
 * coverage so the loved cuisines surface in the fewest swipes.
 */
export class MathsRecommender extends Base {
  readonly name = 'maths'
  private idf = new Map<string, number>()
  constructor(recipes: Array<RecipeLite>, seed = 42) {
    super(recipes, seed)
    const df = new Map<string, number>()
    for (const r of recipes)
      for (const a of new Set(attrsOf(r))) df.set(a, (df.get(a) ?? 0) + 1)
    const n = recipes.length
    for (const [a, c] of df) this.idf.set(a, Math.log((n + 1) / (c + 1)) + 1)
  }
  private importance(a: string): number {
    const base = this.idf.get(a) ?? 1
    if (a.startsWith('c:')) return base * 4
    if (a.startsWith('d:')) return base * 1.5
    return base
  }
  weights(swipes: Array<Swipe>): Map<string, number> {
    const { liked, disliked } = this.partition(swipes)
    const w = new Map<string, number>()
    for (const r of liked)
      for (const a of new Set(attrsOf(r))) w.set(a, (w.get(a) ?? 0) + 1)
    for (const r of disliked)
      for (const a of new Set(attrsOf(r))) w.set(a, (w.get(a) ?? 0) - 1)
    return w
  }
  score(r: RecipeLite, w: Map<string, number>): number {
    // Cuisine is the dominant axis (handled as a direct tally). Ingredients are
    // AVERAGED (not summed) so a recipe's many ingredient attrs cannot overwhelm
    // the single cuisine signal. Diet is a small separate term.
    const cuisine = r.cuisine ? (w.get(`c:${r.cuisine}`) ?? 0) : 0
    let dietS = 0
    let ingS = 0
    let ingN = 0
    for (const a of new Set(attrsOf(r))) {
      if (a.startsWith('d:')) dietS += (w.get(a) ?? 0) * this.importance(a)
      else if (a.startsWith('i:')) {
        ingS += (w.get(a) ?? 0) * (this.idf.get(a) ?? 1)
        ingN++
      }
    }
    const ingMean = ingN ? ingS / ingN : 0
    return 8 * cuisine + dietS + 6 * ingMean
  }
  nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite> {
    const { seen } = this.partition(swipes)
    const seenCuisines = new Set<string>()
    for (const id of seen) {
      const c = this.byId.get(id)?.cuisine
      if (c) seenCuisines.add(c)
    }
    const pool = this.unseen(seen)
    const out: Array<RecipeLite> = []
    const used = new Set(seenCuisines)
    for (const r of pool) {
      if (out.length >= k) break
      if (r.cuisine && !used.has(r.cuisine)) {
        out.push(r)
        used.add(r.cuisine)
      }
    }
    for (const r of pool) {
      if (out.length >= k) break
      if (!out.includes(r)) out.push(r)
    }
    return out.slice(0, k)
  }
  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const w = this.weights(swipes)
    return [...this.recipes]
      .map((r) => ({ r, s: this.score(r, w) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }
}

/** Vector: TF-IDF embedding, diverse (farthest-point) deck, nearest-liked ranking. */
export class VectorRecommender extends Base {
  readonly name: string = 'vector'
  protected emb: Embedder
  constructor(recipes: Array<RecipeLite>, seed = 42, emb?: Embedder) {
    super(recipes, seed)
    this.emb = emb ?? new Embedder(recipes)
  }
  nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite> {
    const { seen } = this.partition(swipes)
    const pool = this.unseen(seen)
    if (pool.length === 0) return []
    // Incremental farthest-point: maintain each candidate's distance to the nearest
    // chosen vector, updating only with the newly picked vector each step. O(pool*k).
    const shown = [...seen]
      .map((id) => this.emb.vec(id))
      .filter((v) => v.size > 0)
    const minDist = pool.map((r) => {
      const v = this.emb.vec(r.id)
      if (shown.length === 0) return 1
      let m = Infinity
      for (const s of shown) m = Math.min(m, 1 - cosine(v, s))
      return m
    })
    const picked: Array<RecipeLite> = []
    const taken = new Set<number>()
    while (picked.length < k && picked.length < pool.length) {
      let bi = -1
      let bd = -1
      for (let i = 0; i < pool.length; i++) {
        if (taken.has(i)) continue
        if (minDist[i]! > bd) {
          bd = minDist[i]!
          bi = i
        }
      }
      if (bi < 0) break
      taken.add(bi)
      picked.push(pool[bi]!)
      const pv = this.emb.vec(pool[bi]!.id)
      for (let i = 0; i < pool.length; i++) {
        if (taken.has(i)) continue
        minDist[i] = Math.min(
          minDist[i]!,
          1 - cosine(this.emb.vec(pool[i]!.id), pv),
        )
      }
    }
    return picked
  }
  protected taste(swipes: Array<Swipe>): {
    like: SparseVec
    dislike: SparseVec
  } {
    const { liked, disliked } = this.partition(swipes)
    return {
      like: centroid(liked.map((r) => this.emb.vec(r.id))),
      dislike: centroid(disliked.map((r) => this.emb.vec(r.id))),
    }
  }
  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const { like, dislike } = this.taste(swipes)
    return [...this.recipes]
      .map((r) => {
        const v = this.emb.vec(r.id)
        return { r, s: cosine(v, like) - 0.4 * cosine(v, dislike) }
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }
}

/** Hybrid: vector diverse deck (learn fast) + a blend of maths and vector ranking. */
export class HybridRecommender extends VectorRecommender {
  readonly name = 'hybrid'
  private maths: MathsRecommender
  constructor(recipes: Array<RecipeLite>, seed = 42, emb?: Embedder) {
    super(recipes, seed, emb)
    this.maths = new MathsRecommender(recipes, seed)
  }
  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const { like, dislike } = this.taste(swipes)
    const w = this.maths.weights(swipes)
    const raw = this.recipes.map((r) => this.maths.score(r, w))
    const maxMag = Math.max(1, ...raw.map((x) => Math.abs(x)))
    return [...this.recipes]
      .map((r, i) => {
        const v = this.emb.vec(r.id)
        const vec = cosine(v, like) - 0.4 * cosine(v, dislike)
        return { r, s: 0.6 * vec + 0.4 * ((raw[i] ?? 0) / maxMag) }
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }
}

/**
 * Adaptive: the production recommender, and the benchmark winner. The lesson from
 * the benchmark was that clever diversity decks BIAS the per-cuisine estimates,
 * while plain uniform sampling reads every cuisine fairly. So the deck stays simple
 * (diverse first round to surface the loved cuisine early, then uniform), and the
 * smarts go into the ranker: cuisine net-preference (the dominant signal) plus a
 * CONFIDENT-only ingredient adjustment. An ingredient counts only once it has been
 * liked at least twice and never disliked (via explain), so it adds real signal
 * without the noise that capped the naive models.
 */
export class AdaptiveRecommender extends Base {
  readonly name = 'adaptive'
  private ing(r: RecipeLite): Array<string> {
    return [
      ...new Set(
        r.ingredients.flatMap((i) =>
          i.name
            .toLowerCase()
            .split(/[^a-z]+/)
            .filter((w) => w.length > 2),
        ),
      ),
    ]
  }
  recommend(swipes: Array<Swipe>, n: number): Array<RecipeLite> {
    const taste = this.explain(swipes)
    const cw = new Map(taste.lovedCuisines.map((c) => [c.cuisine, c.weight]))
    const dislikedC = new Set(taste.dislikedCuisines)
    const lovedI = new Set(taste.lovedIngredients)
    const dislikedI = new Set(taste.dislikedIngredients)
    const score = (r: RecipeLite) => {
      let s = cw.get(r.cuisine ?? '') ?? 0
      if (r.cuisine && dislikedC.has(r.cuisine)) s -= 1
      for (const t of this.ing(r)) {
        if (lovedI.has(t)) s += 0.5
        if (dislikedI.has(t)) s -= 0.5
      }
      return s
    }
    return [...this.recipes]
      .map((r) => ({ r, s: score(r) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.r)
  }
  nextDeck(swipes: Array<Swipe>, k: number): Array<RecipeLite> {
    const { seen } = this.partition(swipes)
    const pool = this.unseen(seen)
    // First round: one recipe per cuisine, so the loved cuisine shows up fast.
    if (swipes.length === 0) {
      const out: Array<RecipeLite> = []
      const used = new Set<string>()
      for (const r of pool) {
        if (out.length >= k) break
        const c = r.cuisine ?? '?'
        if (!used.has(c)) {
          out.push(r)
          used.add(c)
        }
      }
      for (const r of pool) {
        if (out.length >= k) break
        if (!out.includes(r)) out.push(r)
      }
      return out.slice(0, k)
    }
    // After that: uniform random, the unbiased read on each cuisine.
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    return shuffled.slice(0, k)
  }
}

export function makeRecommenders(
  recipes: Array<RecipeLite>,
  seed = 42,
): Array<Recommender> {
  const emb = new Embedder(recipes)
  return [
    new RandomRecommender(recipes, seed),
    new MathsRecommender(recipes, seed),
    new VectorRecommender(recipes, seed, emb),
    new HybridRecommender(recipes, seed, emb),
    new AdaptiveRecommender(recipes, seed),
  ]
}
