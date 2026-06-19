/**
 * Fetch real recipes from TheMealDB (free, no key) into data/seed/recipes.json.
 * TheMealDB gives clean cuisine (strArea), category, ingredients + measures, and
 * tags, which is exactly what the swipe benchmark needs (separable attributes).
 *
 *   pnpm tsx scripts/fetch-recipes.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface MealDbMeal {
  idMeal: string
  strMeal: string
  strCategory?: string
  strArea?: string
  strInstructions?: string
  strTags?: string | null
  strSource?: string | null
  strMealThumb?: string | null
  [k: string]: unknown
}

export interface SeedRecipe {
  id: string
  source: string
  sourceUrl: string | null
  title: string
  cuisine: string | null
  category: string | null
  mealType: string
  dietaryTags: Array<string>
  ingredients: Array<{ name: string; qty?: string }>
  instructions: Array<string>
  imageUrl: string | null
}

// Light heuristics so synthetic preferences over diet have something to bite on.
const MEAT = [
  'chicken',
  'beef',
  'pork',
  'lamb',
  'bacon',
  'sausage',
  'ham',
  'turkey',
]
const FISH = [
  'fish',
  'salmon',
  'tuna',
  'prawn',
  'shrimp',
  'cod',
  'crab',
  'anchovy',
]
const DAIRY = ['milk', 'cheese', 'butter', 'cream', 'yoghurt', 'yogurt']
const GLUTEN = ['flour', 'bread', 'pasta', 'noodle', 'couscous', 'breadcrumb']

function dietaryTags(
  ings: Array<{ name: string }>,
  tags: string | null | undefined,
): Array<string> {
  const names = ings.map((i) => i.name.toLowerCase()).join(' ')
  const out = new Set<string>()
  const hasMeat = MEAT.some((m) => names.includes(m))
  const hasFish = FISH.some((m) => names.includes(m))
  if (!hasMeat && !hasFish) out.add('vegetarian')
  if (
    !hasMeat &&
    !hasFish &&
    !DAIRY.some((m) => names.includes(m)) &&
    !names.includes('egg')
  )
    out.add('vegan')
  if (hasFish) out.add('seafood')
  if (!GLUTEN.some((m) => names.includes(m))) out.add('gluten-free-ish')
  for (const t of (tags ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean))
    out.add(t)
  return [...out]
}

function mapMeal(m: MealDbMeal): SeedRecipe {
  const ingredients: Array<{ name: string; qty?: string }> = []
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] as string | undefined)?.trim()
    const qty = (m[`strMeasure${i}`] as string | undefined)?.trim()
    if (name) ingredients.push({ name, ...(qty ? { qty } : {}) })
  }
  return {
    id: `themealdb-${m.idMeal}`,
    source: 'themealdb',
    sourceUrl: m.strSource ?? null,
    title: m.strMeal,
    cuisine: m.strArea ?? null,
    category: m.strCategory ?? null,
    mealType: 'dinner',
    dietaryTags: dietaryTags(ingredients, m.strTags),
    ingredients,
    instructions: (m.strInstructions ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    imageUrl: m.strMealThumb ?? null,
  }
}

async function main() {
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const seen = new Set<string>()
  const recipes: Array<SeedRecipe> = []
  for (const letter of letters) {
    const res = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`,
    )
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const data = (await res.json()) as { meals: Array<MealDbMeal> | null }
    for (const meal of data.meals ?? []) {
      if (seen.has(meal.idMeal)) continue
      seen.add(meal.idMeal)
      recipes.push(mapMeal(meal))
    }
    process.stdout.write(`${letter}:${recipes.length} `)
  }
  const outDir = join(process.cwd(), 'data', 'seed')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'recipes.json'), JSON.stringify(recipes, null, 0))
  const cuisines = new Set(recipes.map((r) => r.cuisine).filter(Boolean))
  console.log(
    `\nWrote ${recipes.length} recipes, ${cuisines.size} cuisines: ${[...cuisines].join(', ')}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
