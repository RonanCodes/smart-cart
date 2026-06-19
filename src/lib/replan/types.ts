import type {
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
} from '../planner/types'

/**
 * Replan engine types.
 *
 * A "replan" turns a plain-language instruction ("eating out Wednesday", "no
 * fish", "more pasta") into a NEW week, reusing the planner core (#11) for the
 * actual re-pick. We never reimplement ranking here; we only translate the
 * instruction into constraints and hand them to `generateWeek`.
 *
 * The flow is two-stage and deterministic-first:
 *  1. `parseIntent` tries a small set of regex matchers and returns a structured
 *     `ReplanEdit` for the common cases. This needs no network and is fully unit
 *     tested.
 *  2. Anything it cannot match falls back to the AI SDK, which returns the SAME
 *     `ReplanEdit` shape (which days, what constraint). The LLM only emits
 *     constraints; it never invents recipes. The planner picks from the real
 *     catalogue, so a bad LLM answer can never produce a hallucinated meal.
 *
 * Pure (no DB / Worker deps) so the engine runs identically in the test, the
 * benchmark, and the Worker. The server wrapper (`replan-server.ts`) loads the
 * household, recipes and swipes, calls `applyReplan`, and persists a new
 * meal_plan revision.
 */

/** The kinds of edit the engine understands. */
export type ReplanIntentType =
  /** Drop a specific day (eating out / skipping). The day is left empty. */
  | 'skip-day'
  /** Replace one day's pick with the next-best by preference. */
  | 'swap-day'
  /** Add a temporary exclusion (ingredient or cuisine) and replan affected days. */
  | 'exclude'
  /** Bias the week toward a cuisine or ingredient ("more pasta"). */
  | 'more-of'
  /** Recognised, but blocked on price data (#14). Returns a "needs pricing" result. */
  | 'needs-pricing'
  /** Not understood at all; nothing we can do yet. */
  | 'unknown'

/**
 * A structured edit. This is the contract the deterministic parser and the LLM
 * fallback both emit, and the only thing `applyReplan` consumes. Keeping it flat
 * and explicit means the LLM has a tiny, well-typed surface to fill and can never
 * reach past constraints into recipe content.
 */
export interface ReplanEdit {
  type: ReplanIntentType
  /**
   * Day labels this edit targets (e.g. ['Wednesday']). Empty means "the whole
   * week" (used by exclude / more-of, which can touch any day).
   */
  days: Array<string>
  /**
   * For 'exclude' / 'more-of': the ingredient or cuisine term, lowercased.
   * Null for day-only intents.
   */
  term: string | null
  /** Whether `term` is a cuisine ('cuisine') or an ingredient ('ingredient'). */
  termKind: 'cuisine' | 'ingredient' | null
  /** A short human-readable read of what we are about to do, for the UI. */
  reason: string
}

/** Everything `applyReplan` needs to produce the new week. */
export interface ReplanContext {
  /** The current week being edited. */
  week: PlannedWeek
  /** The full recipe catalogue (the planner's candidate pool). */
  recipes: Array<PlannerRecipe>
  /** The household profile (allergies / diet / calorie goal). */
  profile: PlannerProfile
  /** The onboarding swipe signal that seeds the adaptive ranker. */
  swipes: Array<PlannerSwipe>
  /** Optional planner seed so a replan is deterministic in tests. */
  seed?: number
}

/** The result of a replan: the new week plus a read of what changed. */
export interface ReplanResult {
  /** The edit that was applied (deterministic or LLM-derived). */
  edit: ReplanEdit
  /**
   * The new week. For a `needs-pricing` or `unknown` edit this is the unchanged
   * input week (we never silently mangle a week we could not act on).
   */
  week: PlannedWeek
  /** True when the week actually changed. False for no-op / blocked intents. */
  changed: boolean
  /** A short message for the user ("Dropped Wednesday.", "Can't do that yet."). */
  message: string
  /** Whether the edit came from the deterministic parser or the AI fallback. */
  source: 'deterministic' | 'ai-fallback'
}
