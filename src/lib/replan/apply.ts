import { generateWeek } from '../planner/planner'
import type {
  PlannedDay,
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
} from '../planner/types'
import type { ReplanContext, ReplanEdit, ReplanResult } from './types'

/**
 * Apply a structured edit to a week, reusing the planner core for the re-pick.
 *
 * The golden rule: we NEVER reimplement ranking. Every fresh recipe comes out of
 * `generateWeek`, which means the same hard filters (allergies, diet), the same
 * adaptive preference order, and the same soft nudges apply to a replan as to the
 * first week. The edit only changes the candidate pool (exclude), the seeding
 * (more-of), or which days we keep (skip / swap).
 *
 * `applyReplan` is the only consumer of `ReplanEdit`. The deterministic parser
 * and the AI fallback both feed it the same shape, so the two paths share one
 * tested implementation.
 */

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Every word of a recipe we can match a term against: title + ingredients + cuisine. */
function recipeText(r: PlannerRecipe): string {
  return [r.title, r.cuisine ?? '', ...r.ingredients.map((i) => i.name)]
    .map(normalise)
    .join(' ')
}

/** True when a recipe matches a free term (cuisine or ingredient), loosely. */
function recipeMatchesTerm(r: PlannerRecipe, term: string): boolean {
  const t = normalise(term)
  if (!t) return false
  if (r.cuisine && normalise(r.cuisine).includes(t)) return true
  return recipeText(r).includes(t)
}

/**
 * The full ranked order the planner would produce, as recipes (not just a 7-day
 * slice). We get it by asking the planner for a long week (every candidate) and
 * mapping titles/refs back. Reusing `generateWeek` means the order is the planner's
 * order, never our own.
 */
function rankedPool(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<PlannerSwipe>,
  seed?: number,
): Array<PlannerRecipe> {
  const byRef = new Map(recipes.map((r) => [r.id, r]))
  // Ask for far more days than the catalogue has; the planner caps at the pool
  // size and never repeats, so this yields the full ranked candidate list.
  const longWeek = generateWeek(recipes, profile, swipes, {
    days: recipes.length,
    seed,
  })
  return longWeek.days
    .map((d) => byRef.get(d.recipeRef))
    .filter((r): r is PlannerRecipe => r != null)
}

/** Build a fresh PlannedDay for a given label from a recipe. */
function dayFor(label: string, r: PlannerRecipe): PlannedDay {
  return { day: label, meal: r.title, recipeRef: r.id }
}

/**
 * Replace the picks for `targetDays` with the next-best recipes that are not
 * already used elsewhere in the kept week. Days not in `targetDays` are kept as
 * is. The replacement order is the planner's ranked order, so "next-best" means
 * next-best by preference, exactly as the first week was built.
 *
 * When `avoidCurrent` is true (a swap), the current pick of each target day is
 * also excluded so the swap genuinely moves to a *different* recipe rather than
 * re-selecting the same top-ranked one. For an exclude, the current pick is
 * already gone from the pool, so the flag is off and the planner order decides.
 */
function repickDays(
  week: PlannedWeek,
  targetDays: Set<string>,
  pool: Array<PlannerRecipe>,
  avoidCurrent = false,
): { week: PlannedWeek; changed: boolean } {
  const used = new Set(
    week.days
      .filter((d) => !targetDays.has(d.day) && d.recipeRef)
      .map((d) => d.recipeRef),
  )
  if (avoidCurrent) {
    for (const d of week.days) {
      if (targetDays.has(d.day) && d.recipeRef) used.add(d.recipeRef)
    }
  }
  const queue = pool.filter((r) => !used.has(r.id))
  let qi = 0
  let changed = false

  const days = week.days.map((d) => {
    if (!targetDays.has(d.day)) return d
    // Find the next pool recipe not already used (in this loop or the kept days).
    while (qi < queue.length && used.has(queue[qi]!.id)) qi++
    const next = queue[qi]
    if (!next) return d // pool exhausted, leave the day untouched
    qi++
    used.add(next.id)
    if (next.id !== d.recipeRef) changed = true
    return dayFor(d.day, next)
  })

  return { week: { days }, changed }
}

export function applyReplan(
  edit: ReplanEdit,
  ctx: ReplanContext,
  source: 'deterministic' | 'ai-fallback' = 'deterministic',
): ReplanResult {
  const { week, recipes, profile, swipes, seed } = ctx

  switch (edit.type) {
    case 'needs-pricing':
      return {
        edit,
        week,
        changed: false,
        message:
          'I can change the menu, but making it cheaper needs grocery prices, which are not wired up yet.',
        source,
      }

    case 'unknown':
      return {
        edit,
        week,
        changed: false,
        message:
          "I couldn't work out what to change. Try 'eating out Wednesday', 'no fish', 'swap Friday', or 'more pasta'.",
        source,
      }

    case 'skip-day': {
      const targets = new Set(edit.days)
      if (targets.size === 0) {
        return {
          edit,
          week,
          changed: false,
          message: 'Which day are you eating out?',
          source,
        }
      }
      const days = week.days.map((d) => {
        if (!targets.has(d.day)) return d
        if (!d.recipeRef && !d.meal) return d
        // Leave the day empty; the user can refill on request.
        return { day: d.day, meal: '', recipeRef: '' }
      })
      // The week changed iff any targeted day had something to clear.
      const changed = week.days.some(
        (d) => targets.has(d.day) && Boolean(d.recipeRef || d.meal),
      )
      return {
        edit,
        week: { days },
        changed,
        message: changed
          ? `Cleared ${edit.days.join(', ')}.`
          : `${edit.days.join(', ')} was already empty.`,
        source,
      }
    }

    case 'swap-day': {
      // No day named -> swap the whole week's worst-fit is ambiguous; default to
      // swapping every filled day for its next-best alternative is too blunt, so
      // we swap only the named days. If none named, the server passes the day the
      // user is looking at; absent that, we treat it as the last day as a safe,
      // visible default.
      const targets =
        edit.days.length > 0
          ? new Set(edit.days)
          : new Set(
              [week.days[week.days.length - 1]?.day].filter(
                Boolean,
              ) as Array<string>,
            )
      const pool = rankedPool(recipes, profile, swipes, seed)
      const { week: next, changed } = repickDays(week, targets, pool, true)
      return {
        edit,
        week: next,
        changed,
        message: changed
          ? `Swapped ${[...targets].join(', ')} for the next-best pick.`
          : 'No different recipe to swap in.',
        source,
      }
    }

    case 'exclude': {
      const term = edit.term ?? ''
      // Temporary filter: drop every recipe matching the term from the pool, then
      // re-rank with the planner over the reduced catalogue. Affected days (those
      // whose current pick matches the term) get the next-best non-matching pick.
      const filtered = recipes.filter((r) => !recipeMatchesTerm(r, term))
      const pool = rankedPool(filtered, profile, swipes, seed)
      // Affected days = currently-filled days whose pick matches the term.
      const byRef = new Map(recipes.map((r) => [r.id, r]))
      const affected = new Set(
        week.days
          .filter((d) => {
            const r = d.recipeRef ? byRef.get(d.recipeRef) : null
            return r ? recipeMatchesTerm(r, term) : false
          })
          .map((d) => d.day),
      )
      if (affected.size === 0) {
        return {
          edit,
          week,
          changed: false,
          message: `No ${term} in the week, nothing to change. It will stay out of future picks this week.`,
          source,
        }
      }
      const { week: next, changed } = repickDays(week, affected, pool)
      return {
        edit,
        week: next,
        changed,
        message: changed
          ? `Replaced ${affected.size} day(s) that had ${term}.`
          : `Couldn't find a ${term}-free alternative.`,
        source,
      }
    }

    case 'more-of': {
      const term = edit.term ?? ''
      // Bias by seeding the ranker with synthetic "likes" for every recipe that
      // matches the term, on top of the real swipes. The planner does the rest:
      // matching recipes rise in the ranked order, so the regenerated week leans
      // toward the term without us touching the ranking maths.
      const boosted: Array<PlannerSwipe> = [
        ...swipes,
        ...recipes
          .filter((r) => recipeMatchesTerm(r, term))
          .map((r) => ({ recipeId: r.id, like: true })),
      ]
      const next = generateWeek(recipes, profile, boosted, {
        days: week.days.length || 7,
        seed,
      })
      const before = week.days.map((d) => d.recipeRef).join('|')
      const after = next.days.map((d) => d.recipeRef).join('|')
      return {
        edit,
        week: next,
        changed: before !== after,
        message: `Leaned the week toward ${term}.`,
        source,
      }
    }

    default: {
      // Exhaustiveness guard: a new intent type must be handled above. The
      // assignment makes the compiler error here if `ReplanIntentType` grows.
      return assertNever(edit.type, {
        edit,
        week,
        changed: false,
        message: 'Unhandled replan intent.',
        source,
      })
    }
  }
}

/**
 * Compile-time exhaustiveness guard. `value` is typed `never`, so the build fails
 * if a new `ReplanIntentType` is added without a case above. At runtime it returns
 * the supplied fallback result (this branch is unreachable for known types).
 */
function assertNever(_value: never, fallback: ReplanResult): ReplanResult {
  return fallback
}

export { WEEK_DAYS }
