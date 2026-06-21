import type { WeekDayView, WeekView } from '../week-server'
import type { ShoppingItem } from '../shopping/persist'

/**
 * Canned DEMO data. When a household resolves to data mode 'demo' (see
 * data-mode-resolve.ts), the real /week + /shopping loaders return this instead
 * of the DB, so the pitch flow renders the polished Souso screens with fixed,
 * deterministic content and no seeded account. This mirrors the throwaway
 * design.week / design.shopping prototype data, reshaped into the REAL loader
 * types so the production UI is byte-for-byte unchanged.
 *
 * Pure + deterministic: no DB, no clock, no randomness.
 */

/** A fixed Monday, so the week label + URLs are stable across renders. */
const DEMO_WEEK_START = '2026-06-22'
/** A stable id the UI threads into shopping-list links; demo /shopping ignores it. */
export const DEMO_PLAN_ID = 'demo-plan'

/** Build one cooked-dinner day from a recipe sticker slug. */
function dinner(
  day: string,
  meal: string,
  slug: string,
  prepMinutes: number,
  calories: number,
  protein: number,
  cuisine: string,
  price: string,
): WeekDayView {
  return {
    day,
    meal,
    recipeRef: slug,
    cuisine,
    prepMinutes,
    calories,
    protein,
    imageUrl: `/stickers/recipes/${slug}.png`,
    videoUrl: null,
    price,
    alternatives: [],
  }
}

/** An eating-out day: no recipe, renders as the empty/skipped card. */
function out(day: string): WeekDayView {
  return {
    day,
    meal: '',
    recipeRef: '',
    cuisine: null,
    prepMinutes: null,
    calories: null,
    protein: null,
    imageUrl: null,
    videoUrl: null,
    alternatives: [],
  }
}

/** The canned week: five planned dinners + a weekend of eating out. */
export function demoWeekView(): WeekView {
  return {
    planId: DEMO_PLAN_ID,
    weekStart: DEMO_WEEK_START,
    days: [
      dinner(
        'Monday',
        'Chicken Orzo with Spinach',
        'chicken-orzo',
        25,
        540,
        32,
        'Mediterranean',
        '€3,40 pp',
      ),
      dinner(
        'Tuesday',
        'Gnocchi in Romesco',
        'gnocchi-romesco',
        30,
        650,
        22,
        'Spanish',
        '€2,90 pp',
      ),
      dinner(
        'Wednesday',
        'Chicken Skewers & Tomato Salad',
        'chicken-skewers',
        20,
        610,
        40,
        'Greek',
        '€3,60 pp',
      ),
      dinner(
        'Thursday',
        'Creamy Tuscan Orecchiette',
        'orecchiette',
        25,
        640,
        26,
        'Italian',
        '€2,80 pp',
      ),
      dinner(
        'Friday',
        'Sheet-pan Roast Veg & Feta',
        'roast-veg',
        35,
        480,
        18,
        'Vegetarian',
        '€2,40 pp',
      ),
      out('Saturday'),
      out('Sunday'),
    ],
  }
}

/** One canned shopping row. */
function item(
  id: string,
  name: string,
  amount: string,
  checked: boolean,
  createdAt: number,
): ShoppingItem {
  return { id, name, amount, unit: null, checked, source: 'recipe', createdAt }
}

/**
 * The canned cart: the merged ingredients across the demo week, with stickers
 * (ingredient-sticker maps the names) and a couple already ticked off.
 */
export function demoShoppingItems(): Array<ShoppingItem> {
  return [
    item('demo-1', 'Vine tomatoes', '500 g', true, 1),
    item('demo-2', 'Red onion', '3 pcs', true, 2),
    item('demo-3', 'Garlic', '1 bulb', false, 3),
    item('demo-4', 'Lemon', '3 pcs', false, 4),
    item('demo-5', 'Baby spinach', '200 g', false, 5),
    item('demo-6', 'Orzo', '300 g', false, 6),
    item('demo-7', 'Gnocchi', '500 g', false, 7),
    item('demo-8', 'Chicken thigh', '600 g', false, 8),
    item('demo-9', 'Feta', '200 g', true, 9),
    item('demo-10', 'Parmesan', '100 g', false, 10),
    item('demo-11', 'Semi-skimmed milk', '1 L', false, 11),
    item('demo-12', 'Olive oil', '1 bottle', false, 12),
  ]
}
