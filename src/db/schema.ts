import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

/**
 * Smart Cart domain schema (SQLite / D1). The household profile is the
 * personalization core: the longer it is used the more it knows, which is the
 * data moat. Week-menu generation, recipes, and the AH/Jumbo basket layer build
 * on top of this. JSON columns are stored as text (drizzle `mode: 'json'`).
 */

/** A household: the unit Smart Cart plans for. One owner (a signed-in user). */
export const household = sqliteTable('household', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('My household'),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  /** Preferred supermarket for the one-click cart: 'ah' | 'jumbo'. */
  preferredStore: text('preferred_store').notNull().default('ah'),
  /** Soft weekly grocery budget in euro cents (null = no cap). */
  weeklyBudgetCents: integer('weekly_budget_cents'),
  /** Learned taste profile (allergies, dislikes, diet). The real-time memory the
   * feedback loop folds into; read by the planner. */
  profile: text('profile', { mode: 'json' })
    .$type<{
      allergies?: Array<string>
      dislikes?: Array<string>
      dislikedCuisines?: Array<string>
      /** Cuisines the household explicitly LIKES (from onboarding). Biases the
       * planner up; empty/absent leaves ranking unchanged. */
      cuisinesLiked?: Array<string>
      /** Cuisines the household explicitly HATES (from onboarding). Down-weights
       * those recipes; empty/absent leaves ranking unchanged. */
      cuisinesDisliked?: Array<string>
      diet?: string
      caloriesPerDay?: number
      lovedTastes?: Array<string>
      /** Days they usually cook (0=Mon..6=Sun). Drives the default weekly
       * rhythm: only these days get a planned dinner. Empty/absent = all 7. */
      cookDays?: Array<number>
      /** MANUAL skip-day override (0=Mon..6=Sun): the weekdays the household
       * has explicitly told us they skip dinner. When set (non-null), it WINS
       * over the auto-inferred skip-days in generation. null/absent = let Souso
       * keep auto-inferring from past plans. An empty array means "I skip no
       * days" (an explicit override that suppresses inference). */
      skipDays?: Array<number> | null
      /** Kitchen appliances the household has (Oven, Microwave, Stovetop,
       * Blender, Multi cooker, Air fryer). Gates recipe feasibility. */
      equipment?: Array<string>
      /** Soft goals (Eat balanced, Pay less, Lighten mental load, etc.). Used
       * as a soft weighting in the planner, never a hard filter. */
      goals?: Array<string>
      /** Pets in the household, captured to size portions / leftovers. */
      pets?: { cats: number; dogs: number }
      /** Ages of the children (years). Sizes child portions. */
      childrenAges?: Array<number>
    }>()
    .notNull()
    .$defaultFn(() => ({})),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

/** A generated weekly meal plan for a household. */
export const mealPlan = sqliteTable('meal_plan', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => household.id, { onDelete: 'cascade' }),
  /** Monday of the planned week, ISO date string. */
  weekStart: text('week_start').notNull(),
  /** The plan itself: days to meals, plus the derived shopping list. Each day
   * carries a type: 'home' (any recipe length), 'busy' (quick, prep <= 25 min),
   * 'out' (no dinner). Absent type reads as 'home' for older plans. */
  plan: text('plan', { mode: 'json' })
    .$type<{
      days: Array<{
        day: string
        meal: string
        recipeRef?: string
        type?: 'home' | 'busy' | 'out'
      }>
      shoppingList: Array<{ item: string; qty: string }>
    }>()
    .notNull(),
  /** 'draft' | 'confirmed' | 'shopped' (the user shops it; no auto-buy). */
  status: text('status').notNull().default('draft'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

/**
 * Recipe catalogue. Populated from scraped sources (AH Allerhande, Jumbo Recepten,
 * open datasets). Grounding generation in real recipes with real supermarket
 * products is how we avoid hallucinated meals.
 */
export const recipe = sqliteTable('recipe', {
  id: text('id').primaryKey(),
  /** 'ah' | 'jumbo' | 'plus' | 'lidl' | 'hf' | 'manual' */
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  servings: integer('servings'),
  prepMinutes: integer('prep_minutes'),
  calories: integer('calories'),
  /** grams of protein per serving when known. */
  protein: integer('protein'),
  /** cuisine, e.g. mexican, italian, thai. Used to avoid repeating one in a week. */
  cuisine: text('cuisine'),
  /** 'dinner' (default), 'breakfast', 'lunch', 'snack'. */
  mealType: text('meal_type').notNull().default('dinner'),
  /** e.g. hoofdgerecht / bijgerecht */
  category: text('category'),
  dietaryTags: text('dietary_tags', { mode: 'json' })
    .$type<Array<string>>()
    .notNull()
    .$defaultFn(() => []),
  ingredients: text('ingredients', { mode: 'json' })
    .$type<
      Array<{ name: string; qty?: string; unit?: string; productId?: string }>
    >()
    .notNull()
    .$defaultFn(() => []),
  instructions: text('instructions', { mode: 'json' })
    .$type<Array<string>>()
    .notNull()
    .$defaultFn(() => []),
  /**
   * English translation of `title`, baked at seed time for the demo recipe set
   * (AH/Jumbo recipes with images). Null when not translated; the display falls
   * back to the Dutch `title`. The Dutch source is never overwritten (#295).
   */
  titleEn: text('title_en'),
  /** English ingredient lines, parallel to `ingredients` (same qty/unit, English name). */
  ingredientsEn: text('ingredients_en', { mode: 'json' }).$type<
    Array<{ name: string; qty?: string; unit?: string; productId?: string }>
  >(),
  /** English how-to steps, parallel to `instructions`. */
  instructionsEn: text('instructions_en', { mode: 'json' }).$type<
    Array<string>
  >(),
  /**
   * Estimated per-ingredient metric amount, parallel to `ingredients` by index.
   * The scraped AH/Jumbo data has patchy quantities (many lines carry none), so
   * the demo set gets LLM-estimated amounts baked in at seed time (#313). Null
   * when not estimated. `quantitiesEstimated` flags that the displayed amounts +
   * food-waste figures are inferred, so the UI can label them "approx".
   */
  ingredientsQty: text('ingredients_qty', { mode: 'json' }).$type<
    Array<{ qty: number; unit: 'g' | 'ml' | 'stuks' }>
  >(),
  /** True when the amounts on this recipe are LLM-estimated, not from the source (#313). */
  quantitiesEstimated: integer('quantities_estimated', {
    mode: 'boolean',
  }).default(false),
  /** Full scraped blob, kept verbatim as the source of truth. */
  raw: text('raw', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

/**
 * Recipe swipes: the onboarding (and ongoing) Tinder-style like/dislike signal.
 * The preference algorithm reads these to infer dislikes by finding the overlap
 * across rejected recipes. The source of truth for taste.
 */
export const recipeSwipe = sqliteTable('recipe_swipe', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => household.id, { onDelete: 'cascade' }),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipe.id, { onDelete: 'cascade' }),
  /** 'like' | 'dislike' | 'skip' */
  direction: text('direction').notNull(),
  /** Which swipe round this came from, for the fewest-swipes analysis. */
  round: integer('round').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

/**
 * Post-meal feedback: thumbs up or down plus a free note ("not pizza every week").
 * Folded into household.profile in real time so the next plan reflects it.
 */
export const mealFeedback = sqliteTable('meal_feedback', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => household.id, { onDelete: 'cascade' }),
  mealPlanId: text('meal_plan_id').references(() => mealPlan.id, {
    onDelete: 'set null',
  }),
  recipeId: text('recipe_id').references(() => recipe.id, {
    onDelete: 'set null',
  }),
  /** 'up' | 'down' */
  rating: text('rating').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

/**
 * Audit log: the history of what users do (page views, swipes, plan generated,
 * replan, order, feedback). The admin console reads this; the presence Durable
 * Object streams it live during the demo. Live presence lives in the DO; this
 * table is the durable history.
 */
export const event = sqliteTable('event', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  householdId: text('household_id').references(() => household.id, {
    onDelete: 'set null',
  }),
  /** 'page_view' | 'swipe' | 'plan_generated' | 'replan' | 'order' | 'feedback' */
  type: text('type').notNull(),
  /** The route/path for page views, when relevant. */
  path: text('path'),
  /** Free-form payload (the swiped recipe, the replan text, etc). */
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

// Re-export auth tables so a single `drizzle-kit generate` migrates everything.
export * from './auth-schema'
