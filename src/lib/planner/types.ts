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
 * The type of a day, which constrains the recipe the planner may pick:
 *  - 'home': any recipe length.
 *  - 'busy': a quick dinner only (prep <= 25 min), with a graceful fallback to
 *    the shortest available recipe so a busy cook-day is never left empty.
 *  - 'out': no dinner at all, the day is cleared.
 */
export type DayType = 'home' | 'busy' | 'out'

/** Prep-minutes ceiling for a 'busy' day. Recipes over this are not candidates. */
export const BUSY_PREP_CAP_MINUTES = 25

/**
 * The household profile fields the planner reads. Allergies and diet are hard
 * filters; the calorie goal is a soft nudge. `cookDays` drives the default
 * weekly rhythm. Mirrors household.profile in the DB schema, narrowed to what
 * the planner uses.
 */
export interface PlannerProfile {
  allergies?: Array<string>
  diet?: string
  caloriesPerDay?: number
  /**
   * Cuisines the household explicitly LIKES (from onboarding, lowercased). A
   * recipe whose cuisine is in this list gets a soft up-weight. Empty/absent =
   * no cuisine bias, ranking unchanged.
   */
  cuisinesLiked?: Array<string>
  /**
   * Cuisines the household explicitly HATES. A matching recipe is soft
   * down-weighted (not hard-filtered, so the week never empties). Empty/absent =
   * no cuisine bias.
   */
  cuisinesDisliked?: Array<string>
  /**
   * Days the household usually cooks (0=Mon..6=Sun). Drives the default day-type
   * rhythm: cook-days default to 'home', non-cook-days default to 'out'. Empty
   * or absent means all days are 'home' (cook every day).
   */
  cookDays?: Array<number>
}

/** One day's dinner in a generated week. */
export interface PlannedDay {
  /** Day label, Monday first (the week always starts Monday). */
  day: string
  /** The chosen recipe's title, denormalised for the week view. Empty for 'out'. */
  meal: string
  /** The chosen recipe id, the stable reference back into the catalogue. Empty for 'out'. */
  recipeRef: string
  /**
   * The type of this day, which constrained the pick. `generateWeek` always sets
   * it; optional only so older plans and the replan layer (which leaves it
   * untouched) read as 'home' when absent.
   */
  type?: DayType
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
  /**
   * Explicit per-day types, position i maps to day i (Monday first). Overrides
   * the cook-days rhythm so the week-view toggle and onboarding can drive types
   * directly. When omitted, types come from `profile.cookDays`: cook-days are
   * 'home', the rest are 'out'; an empty/absent cookDays means every day is
   * 'home'. A shorter array than `days` falls back to the rhythm for the
   * remaining days.
   */
  dayTypes?: Array<DayType>
}
