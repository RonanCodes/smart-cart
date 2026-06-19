import type { RecipeLite } from './types'

/**
 * A small, dependency-free TF-IDF embedding over recipe attributes (cuisine,
 * category, dietary tags, ingredient tokens). Used by the vector strategy for
 * diverse-deck selection and similarity ranking. Cheap enough to run in the Worker
 * over the catalogue; the heavier cross-catalogue similarity uses Vectorize.
 */

export type SparseVec = Map<string, number>

const STOP = new Set([
  'of',
  'and',
  'the',
  'a',
  'to',
  'with',
  'fresh',
  'large',
  'small',
  'chopped',
  'sliced',
  'ground',
  'finely',
  'optional',
])

function tokens(recipe: RecipeLite): Array<string> {
  const out: Array<string> = []
  // Cuisine is the strongest taste signal, so it dominates the embedding (the
  // similarity should be cuisine-led, with ingredients as the finer texture).
  if (recipe.cuisine) {
    const c = `cuisine:${recipe.cuisine.toLowerCase()}`
    for (let i = 0; i < 8; i++) out.push(c)
  }
  if (recipe.category) out.push(`cat:${recipe.category.toLowerCase()}`)
  for (const t of recipe.dietaryTags) out.push(`diet:${t.toLowerCase()}`)
  for (const ing of recipe.ingredients) {
    for (const w of ing.name.toLowerCase().split(/[^a-z]+/)) {
      if (w.length > 2 && !STOP.has(w)) out.push(`ing:${w}`)
    }
  }
  return out
}

export class Embedder {
  private idf = new Map<string, number>()
  private vecs = new Map<string, SparseVec>()

  constructor(recipes: Array<RecipeLite>) {
    const df = new Map<string, number>()
    const docTokens = new Map<string, Array<string>>()
    for (const r of recipes) {
      const toks = tokens(r)
      docTokens.set(r.id, toks)
      for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1)
    }
    const n = recipes.length
    for (const [t, c] of df) this.idf.set(t, Math.log((n + 1) / (c + 1)) + 1)
    for (const r of recipes) {
      this.vecs.set(r.id, this.build(docTokens.get(r.id) ?? []))
    }
  }

  private build(toks: Array<string>): SparseVec {
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    const v: SparseVec = new Map()
    let norm = 0
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * (this.idf.get(t) ?? 1)
      v.set(t, w)
      norm += w * w
    }
    norm = Math.sqrt(norm) || 1
    for (const [t, w] of v) v.set(t, w / norm)
    return v
  }

  vec(recipeId: string): SparseVec {
    return this.vecs.get(recipeId) ?? new Map()
  }
}

export function cosine(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [t, w] of small) {
    const o = large.get(t)
    if (o !== undefined) dot += w * o
  }
  return dot
}

/** Mean of a set of unit vectors (a taste centroid). */
export function centroid(vecs: Array<SparseVec>): SparseVec {
  const sum: SparseVec = new Map()
  for (const v of vecs)
    for (const [t, w] of v) sum.set(t, (sum.get(t) ?? 0) + w)
  let norm = 0
  for (const w of sum.values()) norm += w * w
  norm = Math.sqrt(norm) || 1
  for (const [t, w] of sum) sum.set(t, w / norm)
  return sum
}
