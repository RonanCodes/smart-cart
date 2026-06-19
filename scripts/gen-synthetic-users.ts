/**
 * Generate synthetic users with clear, separable tastes, plus the recipes they
 * would like (derived in the benchmark from the shared ground-truth). Easy to
 * verify: each user loves a small set of cuisines, maybe dislikes a cuisine or a
 * few ingredients, maybe is vegetarian. The benchmark scores how fast each
 * algorithm reaches each user's true favourites.
 *
 *   pnpm tsx scripts/gen-synthetic-users.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UserProfile } from '../src/lib/recsys/types'

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

const N = 300
const DISLIKE_INGREDIENTS = [
  'prawn',
  'fish',
  'salmon',
  'mushroom',
  'coriander',
  'olive',
  'anchovy',
  'coconut',
  'aubergine',
  'liver',
]
const LOVE_INGREDIENTS = [
  'chicken',
  'beef',
  'chocolate',
  'cheese',
  'potato',
  'rice',
  'pasta',
  'egg',
  'lamb',
  'spinach',
]

function pick<T>(rng: () => number, arr: Array<T>, k: number): Array<T> {
  const copy = [...arr]
  const out: Array<T> = []
  for (let i = 0; i < k && copy.length; i++) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]!)
  }
  return out
}

function main() {
  const recipes = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', 'recipes.json'), 'utf8'),
  ) as Array<{ cuisine: string | null }>
  // Cuisines with enough recipes to form a meaningful favourite set.
  const counts = new Map<string, number>()
  for (const r of recipes)
    if (r.cuisine) counts.set(r.cuisine, (counts.get(r.cuisine) ?? 0) + 1)
  const cuisines = [...counts.entries()]
    .filter(([, c]) => c >= 10)
    .map(([c]) => c)

  const rng = mulberry32(7)
  const users: Array<UserProfile> = []
  for (let i = 0; i < N; i++) {
    // 40% love 1 cuisine, 40% love 2, 20% love 3 (they like many kinds).
    const r = rng()
    const nLoved = r < 0.4 ? 1 : r < 0.8 ? 2 : 3
    const loved = pick(rng, cuisines, nLoved)
    const rest = cuisines.filter((c) => !loved.includes(c))
    const disliked = rng() < 0.4 ? pick(rng, rest, 1) : []
    const dislikedIngredients =
      rng() < 0.6
        ? pick(rng, DISLIKE_INGREDIENTS, 1 + Math.floor(rng() * 2))
        : []
    const lovedIngredients =
      rng() < 0.55 ? pick(rng, LOVE_INGREDIENTS, 1 + Math.floor(rng() * 2)) : []
    const vegetarian = rng() < 0.2
    users.push({
      id: `u${String(i).padStart(3, '0')}`,
      lovedCuisines: loved,
      dislikedCuisines: disliked,
      lovedIngredients,
      dislikedIngredients,
      vegetarian,
    })
  }
  writeFileSync(
    join(process.cwd(), 'data', 'seed', 'synthetic-users.json'),
    JSON.stringify(users, null, 0),
  )
  const avgLoved = users.reduce((s, u) => s + u.lovedCuisines.length, 0) / N
  const veg = users.filter((u) => u.vegetarian).length
  console.log(
    `Wrote ${N} users. avg loved cuisines ${avgLoved.toFixed(2)}, vegetarian ${veg}, usable cuisines ${cuisines.length}`,
  )
}

main()
