/**
 * Import the real recipe catalogue (data/source/recipes.db.gz) into our recipe
 * schema and regenerate data/seed/recipes.json.
 *
 *   pnpm import:recipes
 *
 * The source is a gzipped SQLite built from AH Allerhande, Jumbo Recepten, food.com
 * and TheMealDB (1531 recipes). Tables: recipes / ingredients / instructions. We read
 * it with node:sqlite (Node 22 built-in, no native dep), map each row into OUR
 * `recipe` shape (src/db/schema.ts), and write the seed JSON the rest of the pipeline
 * (seed:recipes -> D1, embed:recipes -> Vectorize, benchmark fixture) reads.
 *
 * Mapping notes (verified against the data):
 * - `meal_type` is NULL for every row, so "dinner-plannable" is inferred from
 *   category / dish_type instead (see DINNER logic). AH `category=hoofdgerecht` is
 *   always a main; food.com dessert/snack/drink categories are excluded.
 * - Ingredient `food` is populated only for food.com/themealdb rows and NULL for
 *   AH/Jumbo. `raw_text` is always present, so the ingredient name is
 *   `food ?? cleaned(raw_text)` (leading quantity + unit stripped).
 * - `cuisine` is comma-separated; we keep the first entry, normalised.
 * - dietary tags come from diet_labels + health_labels (JSON arrays) plus an
 *   inferred `vegetarian` tag when the category/dish_type says so. Tags are
 *   lowercased to match the existing seed convention (vegetarian, vegan, ...).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface SourceRecipe {
  id: number
  source: string
  source_id: string | null
  name: string
  name_nl: string | null
  url: string | null
  image_url: string | null
  description: string | null
  total_time_min: number | null
  servings: number | null
  calories: number | null
  protein_g: number | null
  fat_g: number | null
  carbs_g: number | null
  cuisine: string | null
  meal_type: string | null
  dish_type: string | null
  category: string | null
  difficulty: string | null
  diet_labels: string | null
  health_labels: string | null
  tags: string | null
  rating: number | null
}

interface SourceIngredient {
  recipe_id: number
  raw_text: string
  food: string | null
  quantity: number | null
  unit: string | null
  original_qty: string | null
}

interface SourceInstruction {
  recipe_id: number
  step: number
  text: string
}

/** OUR seed shape, matching seed-recipes.ts field names + the recipe schema. */
interface SeedRecipe {
  id: string
  source: string
  sourceUrl: string | null
  title: string
  servings: number | null
  prepMinutes: number | null
  calories: number | null
  protein: number | null
  cuisine: string | null
  mealType: string
  category: string | null
  dietaryTags: Array<string>
  ingredients: Array<{ name: string; qty?: string; unit?: string }>
  instructions: Array<string>
  dinnerPlannable: boolean
  imageUrl: string | null
}

/** Gunzip the vendored source DB to a temp file we can open read-only. */
function materializeSourceDb(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'smart-cart-import-'))
  const path = join(dir, 'recipes.db')
  const gz = join(process.cwd(), 'data', 'source', 'recipes.db.gz')
  // gunzip -kc keeps the .gz and streams the plain DB to our temp path.
  const out = execFileSync('gunzip', ['-kc', gz], {
    maxBuffer: 256 * 1024 * 1024,
  })
  writeFileSync(path, out)
  return { path, dir }
}

const round = (v: number | null): number | null =>
  v === null ? null : Math.round(v)

/** First entry of a comma-separated cuisine list, normalised to a tidy label. */
function normCuisine(cuisine: string | null): string | null {
  if (!cuisine) return null
  const first = cuisine.split(',')[0]?.trim()
  if (!first) return null
  // Title-case single words; leave multi-word as-is after trimming.
  return first.length <= 2
    ? first.toUpperCase()
    : first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

const DIET_MAP: Record<string, string> = {
  vegetariandiet: 'vegetarian',
  vegandiet: 'vegan',
  glutenfreediet: 'gluten-free',
  lowlactosediet: 'low-lactose',
  dairyfreediet: 'dairy-free',
  paleodiet: 'paleo',
  ketodiet: 'keto',
  lowcarbdiet: 'low-carb',
  lowfatdiet: 'low-fat',
}

function parseJsonArray(raw: string | null): Array<string> {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

/** diet_labels + health_labels + inferred veg -> our lowercase tag vocabulary. */
function dietaryTags(r: SourceRecipe): Array<string> {
  const tags = new Set<string>()
  for (const label of [
    ...parseJsonArray(r.diet_labels),
    ...parseJsonArray(r.health_labels),
  ]) {
    const key = label.toLowerCase().replace(/[^a-z]/g, '')
    tags.add(DIET_MAP[key] ?? label.toLowerCase())
  }
  // food.com / themealdb encode veg in the category/dish_type, not diet_labels.
  const cat = `${r.category ?? ''} ${r.dish_type ?? ''}`.toLowerCase()
  if (cat.includes('vegan')) {
    tags.add('vegan')
    tags.add('vegetarian')
  } else if (cat.includes('vegetarian')) {
    tags.add('vegetarian')
  }
  return [...tags]
}

/**
 * Strip a leading "300 g", "2 el", "4 middelgrote", "1/2 cup" style quantity +
 * unit from an AH/Jumbo raw_text so the bare food name remains. Best-effort: we
 * never block on perfect parsing, a slightly noisy name is fine for similarity.
 */
function cleanRawText(raw: string): string {
  let s = raw.trim()
  // Drop a leading numeric quantity (incl. fractions / decimals / ranges).
  s = s.replace(/^[\d./,-]+\s*/, '')
  // Drop a common leading unit token (Dutch + English short units).
  s = s.replace(
    /^(g|kg|ml|l|el|tl|kop|kopjes?|cup|cups|tsp|tbsp|oz|lb|teen|tenen|stuks?|blik(?:je)?|pak(?:je)?|snufje|takje|bos|bosje|plak(?:jes?)?|tablespoons?|teaspoons?)\b\.?\s*/i,
    '',
  )
  return s.trim() || raw.trim()
}

function ingredientName(i: SourceIngredient): string {
  if (i.food && i.food.trim()) return i.food.trim()
  return cleanRawText(i.raw_text)
}

function qtyString(i: SourceIngredient): string | undefined {
  const q =
    i.original_qty?.trim() || (i.quantity != null ? String(i.quantity) : '')
  const parts = [q, i.unit?.trim()].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

/** Categories/dish-types that are NOT a plannable weeknight dinner. */
const NON_DINNER = [
  'dessert',
  'frozen dessert',
  'beverage',
  'drink',
  'cocktail',
  'candy',
  'bar cookie',
  'drop cookie',
  'cookie',
  'cheesecake',
  'cake',
  'pie',
  'scone',
  'breakfast',
  'bread',
  'quick bread',
  'yeast bread',
  'muffin',
  'sauce',
  'salad dressing',
  'jam',
  'spread',
  'snack',
  'lunch/snacks',
  'nagerecht', // dutch: dessert
  'ontbijt', // dutch: breakfast
  'bijgerecht', // dutch: side dish
  'drank', // dutch: drink
]

/** Inferred dinner-plannability (meal_type is always NULL in the source). */
function isDinnerPlannable(r: SourceRecipe): boolean {
  const cat = (r.category ?? '').toLowerCase()
  const dish = (r.dish_type ?? '').toLowerCase()
  // AH/Jumbo main dish marker.
  if (cat === 'hoofdgerecht') return true
  const text = `${cat} ${dish}`
  if (NON_DINNER.some((bad) => text.includes(bad))) return false
  // Jumbo rows have no category/dish_type at all; treat as plannable (mains).
  return true
}

function main() {
  console.log('[import] gunzipping source DB...')
  const { path, dir } = materializeSourceDb()
  try {
    const db = new DatabaseSync(path, { readOnly: true })

    console.log('[import] reading recipes...')
    const recipes = db
      .prepare(
        `SELECT id, source, source_id, name, name_nl, url, image_url, description,
                total_time_min, servings, calories, protein_g, fat_g, carbs_g,
                cuisine, meal_type, dish_type, category, difficulty,
                diet_labels, health_labels, tags, rating
         FROM recipes`,
      )
      .all() as unknown as Array<SourceRecipe>

    console.log('[import] reading ingredients...')
    const ingredients = db
      .prepare(
        `SELECT recipe_id, raw_text, food, quantity, unit, original_qty
         FROM ingredients ORDER BY recipe_id, id`,
      )
      .all() as unknown as Array<SourceIngredient>

    console.log('[import] reading instructions...')
    const instructions = db
      .prepare(
        `SELECT recipe_id, step, text FROM instructions ORDER BY recipe_id, step`,
      )
      .all() as unknown as Array<SourceInstruction>

    db.close()

    const ingByRecipe = new Map<number, Array<SourceIngredient>>()
    for (const i of ingredients) {
      const list = ingByRecipe.get(i.recipe_id) ?? []
      list.push(i)
      ingByRecipe.set(i.recipe_id, list)
    }
    const instByRecipe = new Map<number, Array<SourceInstruction>>()
    for (const s of instructions) {
      const list = instByRecipe.get(s.recipe_id) ?? []
      list.push(s)
      instByRecipe.set(s.recipe_id, list)
    }

    console.log(`[import] mapping ${recipes.length} recipes...`)
    const seed: Array<SeedRecipe> = []
    let dinnerCount = 0
    for (const r of recipes) {
      const stableId = (r.source_id ?? String(r.id)).trim()
      const dinner = isDinnerPlannable(r)
      if (dinner) dinnerCount++
      seed.push({
        id: `${r.source}-${stableId}`,
        source: r.source,
        sourceUrl: r.url,
        title: r.name_nl?.trim() || r.name.trim(),
        servings: r.servings,
        prepMinutes: r.total_time_min,
        calories: round(r.calories),
        protein: round(r.protein_g),
        cuisine: normCuisine(r.cuisine),
        mealType: 'dinner',
        category: r.category ?? r.dish_type,
        dietaryTags: dietaryTags(r),
        ingredients: (ingByRecipe.get(r.id) ?? []).map((i) => {
          const qty = qtyString(i)
          return qty
            ? { name: ingredientName(i), qty }
            : { name: ingredientName(i) }
        }),
        instructions: (instByRecipe.get(r.id) ?? []).map((s) => s.text),
        dinnerPlannable: dinner,
        imageUrl: r.image_url,
      })
    }

    seed.sort((a, b) => a.id.localeCompare(b.id))

    const outPath = join(process.cwd(), 'data', 'seed', 'recipes.json')
    writeFileSync(outPath, JSON.stringify(seed, null, 0) + '\n')

    const bySource = new Map<string, number>()
    for (const s of seed)
      bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1)
    const withCuisine = seed.filter((s) => s.cuisine).length
    console.log(`[import] wrote ${seed.length} recipes to ${outPath}`)
    console.log(
      `[import] by source: ${[...bySource].map(([k, v]) => `${k}=${v}`).join(', ')}`,
    )
    console.log(
      `[import] dinner-plannable: ${dinnerCount}, with cuisine: ${withCuisine}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main()
