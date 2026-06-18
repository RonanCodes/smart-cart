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
 * core — the longer it is used the more it knows, which is the data moat. The
 * hackathon team builds week-menu generation, recipes, and the AH/Jumbo order layer
 * on top of this.
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
  /** 'draft' | 'confirmed' | 'ordered' — the trust gate lives here. */
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at')
    .$defaultFn(() => new Date())
    .notNull(),
})

// Re-export auth tables so a single `drizzle-kit generate` migrates everything.
export * from './auth-schema'
