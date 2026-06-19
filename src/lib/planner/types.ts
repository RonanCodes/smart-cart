import type { AdaptiveWeights, RecipeLite } from '../recsys/types'

/**
 * The recipe shape the planner needs. It is RecipeLite (what the recommender
 * ranks on) plus the soft-scoring fields (calories, protein, prep time) and the
 * meal type, which never come from the recommender but do nudge the final pick.
 * Kept pure (no DB / Worker deps) so the planner runs identically in the test,
 * the benchmark, and the Worker.
 */
export interface PlannerRecipe extends RecipeLite {
  /** kcal per serving when known, else null. */
  calories: number | null
  /** grams of protein per serving when known, else null. */
  protein: number | null
  /** prep time in minutes when known, else null. */
  prepMinutes: number | null
  /** 'dinner' (default), 'breakfast', 'lunch', 'snack'. Planner only uses dinners. */
  mealType: string
}

/** The onboarding swipe signal that seeds the adaptive ranker for the first week. */
export interface PlannerSwipe {
  recipeId: string
  like: boolean
}

/**
 * The household profile fields the planner reads. Allergies and diet are hard
 * filters; the calorie goal is a soft nudge. Mirrors household.profile in the DB
 * schema, narrowed to what the planner uses.
 */
export interface PlannerProfile {
  allergies?: Array<string>
  diet?: string
  caloriesPerDay?: number
}

/** One day's dinner in a generated week. */
export interface PlannedDay {
  /** Day label, Monday first (the week always starts Monday). */
  day: string
  /** The chosen recipe's title, denormalised for the week view. */
  meal: string
  /** The chosen recipe id, the stable reference back into the catalogue. */
  recipeRef: string
}

/** The generated week: seven dinners, one per day, never a repeat. */
export interface PlannedWeek {
  days: Array<PlannedDay>
}

/** Knobs for the planner, all optional with sensible defaults. */
export interface PlanOptions {
  /** How many days to fill. Defaults to 7. */
  days?: number
  /** Seed for the adaptive recommender so a fixed profile is deterministic. */
  seed?: number
  /**
   * Registry key of the ranking algorithm. Defaults to the configured live
   * default (DEFAULT_ALGORITHM). Lets the admin console / experiments rank with a
   * different algorithm without changing the live config.
   */
  algorithm?: string
  /**
   * Adaptive tuning weights override (also drives the soft-score nudge). Defaults
   * to DEFAULT_ADAPTIVE_WEIGHTS, which reproduces today's behaviour exactly.
   */
  weights?: AdaptiveWeights
}
