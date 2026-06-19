/**
 * Generate realistic synthetic users over the REAL recipe catalogue's feature
 * space. Each user is sampled from one of a few believable taste archetypes
 * ("Mediterranean foodie", "high-protein meat-eater", "veggie quick-cook",
 * "fussy plain-eater", …), so the swipe benchmark measures recall on tastes that
 * actually link people to recipes: cuisine affinity, ingredient likes/dislikes,
 * dietary constraints, prep-time preference, and calorie goals.
 *
 * The data points an archetype draws on are the ones a real food recommender
 * uses to link people to dishes: cuisine, ingredients, dietary constraints,
 * cooking time, and nutrition. (See the close comment for the research sources.)
 *
 * The hidden taste each user carries (the UserProfile) is read back by
 * `src/lib/recsys/ground-truth.ts` to simulate swipes and define each user's
 * true top-N. Generation is fully seeded and reproducible.
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
const RNG_SEED = 7

interface SeedRecipe {
  cuisine: string | null
  dietaryTags: Array<string>
  ingredients: Array<{ name: string }>
  prepMinutes: number | null
  calories: number | null
}

/**
 * Cuisines in the real catalogue are written many ways across sources (Italian /
 * Italiaans, India, United states). We group the equivalents so an archetype can
 * say "Mediterranean" and pick from every spelling that exists in the data, then
 * filter to the groups that actually have enough recipes to form a favourite set.
 */
const CUISINE_GROUPS: Record<string, Array<string>> = {
  mediterranean: [
    'Italian',
    'Italiaans',
    'Spanish',
    'Greek',
    'Turkish',
    'Moroccan',
  ],
  asian: ['Thai', 'Vietnamese', 'Japanese', 'India', 'Malaysian'],
  comfort: [
    'British',
    'United states',
    'Polish',
    'Irish',
    'Canadian',
    'Netherlands',
    'Slovakia',
  ],
}

/** Ingredient axes, expressed in the English the catalogue uses. */
const MEAT = ['chicken', 'beef', 'pork', 'lamb']
const FISH = ['fish', 'salmon', 'prawn', 'shrimp', 'anchovy']
const FUSSY_DISLIKES = [
  'mushroom',
  'coriander',
  'cilantro',
  'olive',
  'anchovy',
  'coconut',
  'aubergine',
  'tofu',
  'chili',
  'curry',
]
const COMFORT_LOVES = ['cheese', 'potato', 'pasta', 'rice', 'chicken', 'beef']

/**
 * A taste archetype. `weight` sets how common it is in the population; `build`
 * turns a fresh RNG draw + the catalogue's available cuisine groups into a hidden
 * UserProfile. Keeping the sampler per-archetype is what gives each user a clear,
 * separable ground-truth top-N instead of uniform noise.
 */
interface Archetype {
  name: string
  weight: number
  build: (
    rng: () => number,
    cuisinesIn: (group: string) => Array<string>,
  ) => Omit<UserProfile, 'id'>
}

function pick<T>(rng: () => number, arr: Array<T>, k: number): Array<T> {
  const copy = [...arr]
  const out: Array<T> = []
  for (let i = 0; i < k && copy.length; i++) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]!)
  }
  return out
}

const ARCHETYPES: Array<Archetype> = [
  {
    // Loves Italian/Spanish/Greek/Turkish, leans veg-friendly, lighter plates.
    name: 'mediterranean-foodie',
    weight: 0.18,
    build: (rng, cuisinesIn) => ({
      lovedCuisines: pick(rng, cuisinesIn('mediterranean'), 2),
      dislikedCuisines: rng() < 0.4 ? pick(rng, cuisinesIn('asian'), 1) : [],
      lovedIngredients: pick(rng, ['cheese', 'tomato', 'olive', 'spinach'], 2),
      dislikedIngredients: rng() < 0.3 ? ['coconut'] : [],
      vegetarian: false,
      caloriePreference: 'lighter' as const,
      maxPrepMinutes: null,
    }),
  },
  {
    // Asian-leaning explorer: Thai/Vietnamese/Indian, spice-tolerant, fish-ok.
    name: 'asian-explorer',
    weight: 0.16,
    build: (rng, cuisinesIn) => ({
      lovedCuisines: pick(rng, cuisinesIn('asian'), 1 + Math.floor(rng() * 2)),
      dislikedCuisines: [],
      lovedIngredients: pick(rng, ['curry', 'rice', 'noodle', 'coconut'], 2),
      dislikedIngredients: [],
      vegetarian: false,
      caloriePreference: null,
      maxPrepMinutes: null,
    }),
  },
  {
    // High-protein meat-eater: hearty portions, meat-forward, dislikes tofu/veg-only.
    name: 'high-protein-meat-eater',
    weight: 0.16,
    build: (rng) => ({
      lovedCuisines: [],
      dislikedCuisines: [],
      lovedIngredients: pick(rng, MEAT, 2),
      dislikedIngredients: ['tofu'],
      vegetarian: false,
      caloriePreference: 'hearty' as const,
      maxPrepMinutes: null,
    }),
  },
  {
    // Veggie quick-cook: vegetarian, wants it fast and light.
    name: 'veggie-quick-cook',
    weight: 0.14,
    build: (rng) => ({
      lovedCuisines: [],
      dislikedCuisines: [],
      lovedIngredients: pick(rng, ['cheese', 'spinach', 'bean', 'lentil'], 1),
      dislikedIngredients: [],
      vegetarian: true,
      caloriePreference: 'lighter' as const,
      maxPrepMinutes: 20,
    }),
  },
  {
    // Busy weeknight cook: any cuisine, but it has to be quick.
    name: 'busy-weeknight-cook',
    weight: 0.14,
    build: (rng, cuisinesIn) => ({
      lovedCuisines: rng() < 0.5 ? pick(rng, cuisinesIn('comfort'), 1) : [],
      dislikedCuisines: [],
      lovedIngredients: pick(rng, ['chicken', 'pasta', 'rice'], 1),
      dislikedIngredients: rng() < 0.3 ? pick(rng, FISH, 1) : [],
      vegetarian: false,
      caloriePreference: null,
      maxPrepMinutes: 20,
    }),
  },
  {
    // Fussy plain-eater: comfort cuisines, a wide dislike list, no fish.
    name: 'fussy-plain-eater',
    weight: 0.12,
    build: (rng, cuisinesIn) => ({
      lovedCuisines: pick(rng, cuisinesIn('comfort'), 1),
      dislikedCuisines: pick(rng, cuisinesIn('asian'), 1),
      lovedIngredients: pick(rng, COMFORT_LOVES, 2),
      dislikedIngredients: [
        ...pick(rng, FUSSY_DISLIKES, 3),
        ...pick(rng, FISH, 1),
      ],
      vegetarian: false,
      caloriePreference: null,
      maxPrepMinutes: null,
    }),
  },
  {
    // Comfort-food traditionalist: British/American/Polish, hearty, meat + cheese.
    name: 'comfort-food-traditionalist',
    weight: 0.1,
    build: (rng, cuisinesIn) => ({
      lovedCuisines: pick(
        rng,
        cuisinesIn('comfort'),
        1 + Math.floor(rng() * 2),
      ),
      dislikedCuisines: [],
      lovedIngredients: pick(rng, COMFORT_LOVES, 2),
      dislikedIngredients: rng() < 0.4 ? pick(rng, FISH, 1) : [],
      vegetarian: false,
      caloriePreference: 'hearty' as const,
      maxPrepMinutes: null,
    }),
  },
]

function chooseArchetype(rng: () => number): Archetype {
  const total = ARCHETYPES.reduce((s, a) => s + a.weight, 0)
  let roll = rng() * total
  for (const a of ARCHETYPES) {
    roll -= a.weight
    if (roll <= 0) return a
  }
  return ARCHETYPES[ARCHETYPES.length - 1]!
}

function main() {
  const recipes = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'seed', 'recipes.json'), 'utf8'),
  ) as Array<SeedRecipe>

  // Which cuisine groups have enough recipes to form a meaningful favourite set,
  // and which exact spellings within each group actually appear in the catalogue.
  const counts = new Map<string, number>()
  for (const r of recipes)
    if (r.cuisine) counts.set(r.cuisine, (counts.get(r.cuisine) ?? 0) + 1)
  const presentInGroup = (group: string): Array<string> =>
    (CUISINE_GROUPS[group] ?? []).filter((c) => (counts.get(c) ?? 0) > 0)

  const rng = mulberry32(RNG_SEED)
  const users: Array<UserProfile> = []
  const archetypeCounts = new Map<string, number>()
  for (let i = 0; i < N; i++) {
    const arch = chooseArchetype(rng)
    const taste = arch.build(rng, presentInGroup)
    archetypeCounts.set(arch.name, (archetypeCounts.get(arch.name) ?? 0) + 1)
    users.push({
      id: `u${String(i).padStart(3, '0')}`,
      archetype: arch.name,
      lovedCuisines: taste.lovedCuisines,
      dislikedCuisines: taste.dislikedCuisines,
      lovedIngredients: taste.lovedIngredients,
      dislikedIngredients: taste.dislikedIngredients,
      vegetarian: taste.vegetarian,
      maxPrepMinutes: taste.maxPrepMinutes ?? null,
      caloriePreference: taste.caloriePreference ?? null,
    })
  }

  writeFileSync(
    join(process.cwd(), 'data', 'seed', 'synthetic-users.json'),
    JSON.stringify(users, null, 0),
  )

  const veg = users.filter((u) => u.vegetarian).length
  const quick = users.filter((u) => u.maxPrepMinutes != null).length
  console.log(
    `Wrote ${N} users (seed ${RNG_SEED}). vegetarian ${veg}, prep-constrained ${quick}.`,
  )
  for (const [name, c] of [...archetypeCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${name}: ${c}`)
  }
}

main()
