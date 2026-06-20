import { generateWeek, rankRecipes, resolveDayTypes } from '../planner/planner'
import { BUSY_PREP_CAP_MINUTES } from '../planner/types'
import type {
  DayType,
  PlannedDay,
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
} from '../planner/types'
import { expandTerm } from './term-synonyms'
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

/**
 * True when a recipe matches a free term (cuisine or ingredient), loosely.
 *
 * The term is expanded through the EN/NL synonym map first, so a user typing
 * "rice" matches the catalogue's Dutch "rijst"/"risotto" text, "pasta" matches
 * "spaghetti"/"penne", and so on. An unmapped term still matches its literal
 * substring. We match across title + ingredients + cuisine.
 */
function recipeMatchesTerm(r: PlannerRecipe, term: string): boolean {
  const variants = expandTerm(term)
  if (variants.length === 0) return false
  const cuisine = r.cuisine ? normalise(r.cuisine) : ''
  const text = recipeText(r)
  return variants.some((v) => cuisine.includes(v) || text.includes(v))
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

/** True when a recipe is quick enough for a 'busy' day (mirrors the planner). */
function fitsBusy(r: PlannerRecipe): boolean {
  return r.prepMinutes != null && r.prepMinutes <= BUSY_PREP_CAP_MINUTES
}

/**
 * Fill a week from a caller-supplied, already-ordered candidate pool, honouring
 * each day's type and the no-repeat rule. This is the SAME day-fill `generateWeek`
 * does (busy days take quick dinners with the shortest-available fallback, out
 * days stay empty, no recipe repeats), but it walks the pool order we hand it
 * rather than re-ranking. The "more-of" lean uses it to fill from a term-biased
 * pool, so matching recipes land first while the planner's order still decides
 * everything else.
 *
 * Day types come from the existing week where present (a replan must not silently
 * un-skip an "eating out" day), falling back to the profile's cook-days rhythm.
 */
function fillFromPool(
  week: PlannedWeek,
  pool: Array<PlannerRecipe>,
  profile: PlannerProfile,
  seed?: number,
): PlannedWeek {
  void seed // pool order is already seeded upstream; kept for signature parity.
  const days = week.days.length || 7
  const rhythm = resolveDayTypes(days, profile)
  const types: Array<DayType> = week.days.map(
    (d, i) => d.type ?? rhythm[i] ?? 'home',
  )

  const used = new Set<string>()
  const planned: Array<PlannedDay> = week.days.map((d, i) => {
    const type = types[i] ?? 'home'
    const label = d.day

    if (type === 'out') return { day: label, meal: '', recipeRef: '', type }

    const wantsQuick = type === 'busy'
    let pick = pool.find((r) => !used.has(r.id) && (!wantsQuick || fitsBusy(r)))

    // Busy-day fallback: nothing quick left, take the shortest unused recipe.
    if (!pick && wantsQuick) {
      pick = pool
        .filter((r) => !used.has(r.id))
        .sort((a, b) => {
          const pa = a.prepMinutes ?? Number.POSITIVE_INFINITY
          const pb = b.prepMinutes ?? Number.POSITIVE_INFINITY
          if (pa !== pb) return pa - pb
          return a.id < b.id ? -1 : 1
        })[0]
    }

    if (!pick) return { day: label, meal: '', recipeRef: '', type }

    used.add(pick.id)
    return { day: label, meal: pick.title, recipeRef: pick.id, type }
  })

  return { days: planned }
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
      const byRef = new Map(recipes.map((r) => [r.id, r]))

      // How many filled dinners already match the term, before we touch anything.
      const matchesBefore = week.days.filter((d) => {
        const r = d.recipeRef ? byRef.get(d.recipeRef) : null
        return r ? recipeMatchesTerm(r, term) : false
      }).length

      // Hard-filtered, planner-ranked pool (allergies + diet + dinners only).
      // We bias toward the term by floating matching recipes to the FRONT of this
      // pool while keeping the planner's preference order WITHIN each partition,
      // then fill the week from the biased pool. This is a genuine, visible lean
      // (not a few synthetic swipes the recommender may drown out), and it never
      // touches the ranking maths or the hard filters: a matching recipe that is
      // hard-filtered out (allergy/diet) is simply absent from the pool.
      const ranked = rankRecipes(recipes, profile, swipes, { seed })
      const matchingPool = ranked.filter((r) => recipeMatchesTerm(r, term))

      // Honest "none found": the catalogue (after hard filters) has nothing that
      // matches the term, so we can not lean toward it. Leave the week unchanged
      // and say so plainly instead of asserting a lean that did not happen.
      if (matchingPool.length === 0) {
        return {
          edit,
          week,
          changed: false,
          message: `I couldn't find more ${term} dishes in the current menu, so I left the week as it is.`,
          source,
        }
      }

      const rest = ranked.filter((r) => !recipeMatchesTerm(r, term))
      const biasedPool = [...matchingPool, ...rest]

      const next = fillFromPool(week, biasedPool, profile, seed)
      const before = week.days.map((d) => d.recipeRef).join('|')
      const after = next.days.map((d) => d.recipeRef).join('|')
      const changed = before !== after

      const matchesAfter = next.days.filter((d) => {
        const r = d.recipeRef ? byRef.get(d.recipeRef) : null
        return r ? recipeMatchesTerm(r, term) : false
      }).length
      const gained = matchesAfter - matchesBefore

      // Word the reply from the real diff, never optimistically. We only claim a
      // lean when matching dinners actually went up; otherwise we say honestly
      // that the week could not take more (already leaned, or no room after the
      // hard filters and the no-repeat rule).
      let message: string
      if (gained > 0) {
        message = `Swapped ${gained} dinner${gained === 1 ? '' : 's'} to ${term} dishes (now ${matchesAfter} of ${next.days.filter((d) => d.recipeRef).length}).`
      } else if (matchesAfter > 0) {
        message = `The week already leans toward ${term} (${matchesAfter} ${term} dinner${matchesAfter === 1 ? '' : 's'}); I couldn't fit more without repeating a meal.`
      } else {
        message = `I couldn't find more ${term} dishes in the current menu, so I left the week as it is.`
      }

      return {
        edit,
        week: next,
        // Only report a change when something genuinely moved. A reshuffle that
        // does not raise the term count is still a real week change.
        changed,
        message,
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
