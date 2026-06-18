import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  date,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

/**
 * Smart Cart domain schema (starter). The household profile is the personalization
 * core: the longer it is used the more it knows, which is the data moat.
 * Week-menu generation, recipes, and the AH/Jumbo basket layer build on top of this.
 */

/** A household: the unit Smart Cart plans for. One owner (a signed-in user). */
export const household = pgTable('household', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('My household'),
  /** Number of people the weekly plan should cater for. */
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  /** Preferred supermarket for the one-click cart: 'ah' | 'jumbo'. */
  preferredStore: text('preferred_store').notNull().default('ah'),
  /** Soft weekly grocery budget in euro cents (null = no cap). */
  weeklyBudgetCents: integer('weekly_budget_cents'),
  /** Free-form learned taste profile, allergies, dislikes, diet. JSON so the agent
   * can extend it without a migration per signal. */
  profile: jsonb('profile')
    .$type<{
      allergies?: Array<string>
      dislikes?: Array<string>
      diet?: string
      caloriesPerDay?: number
      lovedTastes?: Array<string>
    }>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at')
    .$defaultFn(() => new Date())
    .notNull(),
})

/** A generated weekly meal plan for a household. */
export const mealPlan = pgTable('meal_plan', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => household.id, { onDelete: 'cascade' }),
  /** Monday of the planned week. */
  weekStart: date('week_start').notNull(),
  /** The plan itself: days → meals, plus the derived shopping list. Agent-written. */
  plan: jsonb('plan')
    .$type<{
      days: Array<{ day: string; meal: string; recipeRef?: string }>
      shoppingList: Array<{ item: string; qty: string }>
    }>()
    .notNull(),
  /** 'draft' | 'confirmed' | 'shopped', the user shops it themselves (no auto-buy). */
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
})

/**
 * Recipe catalogue. Populated from scraped sources (AH Allerhande, Jumbo Recepten,
 * open datasets). Grounding week-menu generation in real recipes with real
 * supermarket products is how we avoid the LLM hallucinating "random" recipes.
 * Mostly jsonb so the scrape shape can evolve without a migration per source.
 */
export const recipe = pgTable('recipe', {
  id: text('id').primaryKey(),
  /** 'ah' | 'jumbo' | 'plus' | 'lidl' | 'hf' | 'manual' */
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  servings: integer('servings'),
  prepMinutes: integer('prep_minutes'),
  calories: integer('calories'),
  /** e.g. hoofdgerecht / bijgerecht */
  category: text('category'),
  /** vegan, vegetarian, glutenvrij, lactosevrij, keto, … */
  dietaryTags: jsonb('dietary_tags')
    .$type<Array<string>>()
    .notNull()
    .default([]),
  /** Supermarket-specific products with quantities, ready to map to a basket. */
  ingredients: jsonb('ingredients')
    .$type<
      Array<{ name: string; qty?: string; unit?: string; productId?: string }>
    >()
    .notNull()
    .default([]),
  instructions: jsonb('instructions')
    .$type<Array<string>>()
    .notNull()
    .default([]),
  /** Full scraped blob, kept verbatim as the source of truth. */
  raw: jsonb('raw'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
})

// Re-export auth tables so a single `drizzle-kit generate` migrates everything.
export * from './auth-schema'
