import { generateWeek } from '../../planner/planner'
import type {
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
} from '../../planner/types'
import type { TermMatcher } from '../../replan/types'
import type { TermMatcherFactory } from '../week-session'
import type { ReplanFixture } from './types'

const SWIPES: Array<PlannerSwipe> = [
  { recipeId: 'r0', like: true },
  { recipeId: 'r2', like: true },
  { recipeId: 'r25', like: false },
]

/** Substring stand-in for embedding term-match in offline evals. */
export function substringMatcher(term: string): TermMatcher {
  const t = term.toLowerCase().trim()
  return (r: PlannerRecipe): boolean => {
    const text = [r.title, r.cuisine ?? '', ...r.ingredients.map((i) => i.name)]
      .join(' ')
      .toLowerCase()
    return text.includes(t)
  }
}

export function matcherFactory(
  withMatcher: boolean,
): TermMatcherFactory | undefined {
  if (!withMatcher) return undefined
  return (term) => substringMatcher(term)
}

function standardCatalogue(): Array<PlannerRecipe> {
  const cuisines = ['Italian', 'Thai', 'Mexican', 'Japanese']
  const out: Array<PlannerRecipe> = []
  let id = 0
  for (const cuisine of cuisines) {
    for (let i = 0; i < 25; i++) {
      const fish = i % 4 === 0
      out.push({
        id: `r${id++}`,
        title: fish ? `${cuisine} fish ${i}` : `${cuisine} dish ${i}`,
        cuisine,
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: [],
        ingredients: [
          { name: fish ? 'salmon fillet' : 'chicken breast' },
          { name: 'onion' },
          { name: 'garlic' },
        ],
        calories: 400 + (i % 5) * 120,
        protein: 15 + (i % 4) * 12,
        prepMinutes: 10 + (i % 6) * 8,
      })
    }
  }
  return out
}

function fishHeavyCatalogue(): Array<PlannerRecipe> {
  return standardCatalogue()
}

function fishHeavySwipes(recipes: Array<PlannerRecipe>): Array<PlannerSwipe> {
  return recipes
    .filter((r) => r.ingredients.some((i) => i.name.includes('salmon')))
    .slice(0, 8)
    .map((r) => ({ recipeId: r.id, like: true }))
}

function dutchRiceCatalogue(withRice: boolean): Array<PlannerRecipe> {
  const out: Array<PlannerRecipe> = []
  let id = 0
  const nonRice = [
    { title: 'Vegan banh mi', ing: 'tofu' },
    { title: 'Pasta pesto', ing: 'spaghetti' },
    { title: 'Groentesoep', ing: 'wortel' },
    { title: 'Caprese salade', ing: 'mozzarella' },
  ]
  for (let i = 0; i < 16; i++) {
    const base = nonRice[i % nonRice.length]!
    out.push({
      id: `n${id++}`,
      title: `${base.title} ${i}`,
      cuisine: 'Hollands',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: base.ing }, { name: 'ui' }],
      calories: 500,
      protein: 20,
      prepMinutes: 20,
    })
  }
  if (withRice) {
    for (let i = 0; i < 8; i++) {
      out.push({
        id: `rijst${id++}`,
        title:
          i % 2 === 0
            ? `Sticky kip met gewokte groenten en rijst ${i}`
            : `Risotto met pompoen ${i}`,
        cuisine: 'Aziatisch',
        category: 'Main',
        mealType: 'dinner',
        dietaryTags: i % 2 === 1 ? ['vegetarian'] : [],
        ingredients:
          i % 2 === 0
            ? [{ name: 'rijst' }, { name: 'kip' }]
            : [{ name: 'risottorijst' }, { name: 'pompoen' }],
        calories: 600,
        protein: 25,
        prepMinutes: 30,
      })
    }
  }
  return out
}

function vegetarianRiceCatalogue(): Array<PlannerRecipe> {
  return [
    {
      id: 'meaty-rice',
      title: 'Kip met rijst',
      cuisine: 'Aziatisch',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: [],
      ingredients: [{ name: 'rijst' }, { name: 'kip' }],
      calories: 600,
      protein: 30,
      prepMinutes: 25,
    },
    {
      id: 'veg-rice',
      title: 'Groenterisotto',
      cuisine: 'Italiaans',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: ['vegetarian'],
      ingredients: [{ name: 'risottorijst' }, { name: 'courgette' }],
      calories: 500,
      protein: 15,
      prepMinutes: 30,
    },
    {
      id: 'veg-salad',
      title: 'Salade',
      cuisine: 'Hollands',
      category: 'Main',
      mealType: 'dinner',
      dietaryTags: ['vegetarian'],
      ingredients: [{ name: 'sla' }],
      calories: 300,
      protein: 8,
      prepMinutes: 10,
    },
  ]
}

function baseFixture(
  id: string,
  description: string,
  tags: Array<string>,
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<PlannerSwipe>,
  week?: PlannedWeek,
  withMatcher = true,
): ReplanFixture {
  const w = week ?? generateWeek(recipes, profile, swipes, { seed: 7 })
  return {
    id,
    description,
    recipes,
    profile,
    swipes,
    week: w,
    seed: 7,
    withMatcher,
    tags,
  }
}

const FIXTURES: Record<string, ReplanFixture> = {}

function register(f: ReplanFixture) {
  FIXTURES[f.id] = f
}

{
  const recipes = standardCatalogue()
  register(
    baseFixture(
      'standard',
      'Default catalogue, neutral profile, full matcher',
      ['baseline'],
      recipes,
      {},
      SWIPES,
    ),
  )

  const fishRecipes = fishHeavyCatalogue()
  const fishSwipes = fishHeavySwipes(fishRecipes)
  register(
    baseFixture(
      'fish-heavy',
      'Week seeded to include fish dinners',
      ['exclude', 'fish'],
      fishRecipes,
      {},
      fishSwipes,
      generateWeek(fishRecipes, {}, fishSwipes, { seed: 7 }),
    ),
  )

  const dutchWithRice = dutchRiceCatalogue(true)
  const noRiceSwipes: Array<PlannerSwipe> = dutchWithRice
    .filter((r) => !r.title.toLowerCase().includes('rijst'))
    .slice(0, 6)
    .map((r) => ({ recipeId: r.id, like: true }))
  register(
    baseFixture(
      'dutch-rice',
      'Dutch catalogue with rijst/risotto dishes, week avoids rice initially',
      ['lean-more', 'dutch', 'rice'],
      dutchWithRice,
      {},
      noRiceSwipes,
      generateWeek(dutchWithRice, {}, noRiceSwipes, { seed: 7 }),
    ),
  )

  register(
    baseFixture(
      'dutch-no-rice',
      'Dutch catalogue with zero rice dishes',
      ['lean-more', 'decline'],
      dutchRiceCatalogue(false),
      {},
      [],
      generateWeek(dutchRiceCatalogue(false), {}, [], { seed: 7 }),
    ),
  )

  register(
    baseFixture(
      'vegetarian-rice',
      'Single-day veg week; meaty rice exists but is hard-filtered',
      ['diet', 'lean-more'],
      vegetarianRiceCatalogue(),
      { diet: 'vegetarian' },
      [],
      {
        days: [{ day: 'Monday', meal: 'Salade', recipeRef: 'veg-salad' }],
      },
    ),
  )

  {
    const recipes = standardCatalogue()
    const week = generateWeek(recipes, {}, SWIPES, { seed: 7 })
    const cleared = {
      days: week.days.map((d) =>
        d.day === 'Wednesday'
          ? { day: d.day, meal: '', recipeRef: '', type: 'out' as const }
          : d,
      ),
    }
    register(
      baseFixture(
        'wednesday-empty',
        'Wednesday already cleared (eating out)',
        ['skip', 'no-op'],
        recipes,
        {},
        SWIPES,
        cleared,
      ),
    )
  }

  register(
    baseFixture(
      'no-matcher',
      'Same as standard but semantic matcher unavailable',
      ['exclude', 'decline', 'offline'],
      standardCatalogue(),
      {},
      SWIPES,
      undefined,
      false,
    ),
  )
}

export function getFixture(id: string): ReplanFixture {
  const f = FIXTURES[id]
  if (!f) throw new Error(`Unknown replan eval fixture: ${id}`)
  return f
}

export function allFixtures(): Array<ReplanFixture> {
  return Object.values(FIXTURES)
}

export function recipeIds(recipes: Array<PlannerRecipe>): Array<string> {
  return recipes.map((r) => r.id)
}
