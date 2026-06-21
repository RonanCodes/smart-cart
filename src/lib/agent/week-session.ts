import { generateWeek, rankRecipes, resolveDayTypes } from '../planner/planner'
import { BUSY_PREP_CAP_MINUTES } from '../planner/types'
import type {
  DayType,
  PlannedDay,
  PlannedWeek,
  PlannerProfile,
  PlannerRecipe,
  PlannerSwipe,
  SoftPenalties,
} from '../planner/types'
import type { TermMatcher } from '../replan/types'

/**
 * The mutable working week the replan agent edits across a tool loop.
 *
 * The golden rule is unchanged from the old `applyReplan`: we NEVER reimplement
 * ranking. Every fresh recipe comes out of the planner core (`generateWeek` /
 * `rankRecipes`), so the same hard filters (allergies, diet), the same adaptive
 * preference order, and the same soft nudges apply to a replan as to the first
 * week. A tool only changes the candidate pool (exclude), the seeding (lean-more),
 * or which days we keep (skip / swap / quicker).
 *
 * The class is the single source of truth for the in-progress week: each tool
 * mutates `this.week` and returns a short, honest summary. When the loop finishes
 * the server persists `getWeek()` as a new `meal_plan` revision. Keeping the maths
 * here (not in the model) is what guarantees the hard rule "no hallucinated
 * recipes": the model only ever names a constraint, the planner always picks the
 * real dish.
 *
 * Pure: no DB / Worker / network deps. Term matching is injected as an async
 * factory (`buildMatcher`) so the embedding path stays server-only and tests can
 * stand in a synchronous matcher.
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

/**
 * Embed a term and return a cosine matcher for it, or null when matching is
 * unavailable (no key / no vectors / empty term). Async because the live path
 * embeds the term against the OpenAI API; tests inject a synchronous stand-in.
 */
export type TermMatcherFactory = (
  term: string,
) => Promise<TermMatcher | null> | TermMatcher | null

/** The result of one tool's edit: did the week move, and what to tell the user. */
export interface SessionEdit {
  changed: boolean
  summary: string
}

export interface WeekSessionInit {
  /** The week being edited (Monday first). */
  week: PlannedWeek
  /** The full recipe catalogue (the planner's candidate pool). */
  recipes: Array<PlannerRecipe>
  /** The household profile (allergies / diet / calorie goal / cook days). */
  profile: PlannerProfile
  /** The onboarding swipe signal that seeds the adaptive ranker. */
  swipes: Array<PlannerSwipe>
  /** Optional planner seed so a replan is deterministic in tests. */
  seed?: number
  /**
   * Soft penalties from learned memory + recent week history (variety / dislikes
   * / recently-served), so a replan respects the same memory the first week does.
   * Absent/empty leaves ranking unchanged. Threaded into every re-rank below.
   */
  penalties?: SoftPenalties
  /**
   * Builds a semantic term matcher on demand (exclude / lean-more). Absent when
   * no embedding key is wired, in which case the term-driven tools decline
   * cleanly rather than fall back to substring matching.
   */
  buildMatcher?: TermMatcherFactory
}

/** True when a recipe is quick enough for a 'busy' day (mirrors the planner). */
function fitsBusy(r: PlannerRecipe): boolean {
  return r.prepMinutes != null && r.prepMinutes <= BUSY_PREP_CAP_MINUTES
}

/** Build a fresh PlannedDay for a given label from a recipe. */
function dayFor(label: string, r: PlannerRecipe, type?: DayType): PlannedDay {
  return { day: label, meal: r.title, recipeRef: r.id, type }
}

/**
 * The full ranked order the planner would produce, as recipes (not just a 7-day
 * slice). We get it by asking the planner for a long week (every candidate) and
 * mapping refs back. Reusing `generateWeek` means the order is the planner's
 * order, never our own.
 */
function rankedPool(
  recipes: Array<PlannerRecipe>,
  profile: PlannerProfile,
  swipes: Array<PlannerSwipe>,
  seed?: number,
  penalties?: SoftPenalties,
): Array<PlannerRecipe> {
  const byRef = new Map(recipes.map((r) => [r.id, r]))
  const longWeek = generateWeek(recipes, profile, swipes, {
    days: recipes.length,
    seed,
    penalties,
  })
  return longWeek.days
    .map((d) => byRef.get(d.recipeRef))
    .filter((r): r is PlannerRecipe => r != null)
}

/**
 * Replace the picks for `targetDays` with the next-best recipes not already used
 * elsewhere in the kept week. The replacement order is the planner's ranked order,
 * so "next-best" means next-best by preference. When `avoidCurrent` is true (a
 * swap) the current pick of each target day is also excluded so the swap moves to a
 * genuinely different recipe.
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
    while (qi < queue.length && used.has(queue[qi]!.id)) qi++
    const next = queue[qi]
    if (!next) return d
    qi++
    used.add(next.id)
    if (next.id !== d.recipeRef) changed = true
    return dayFor(d.day, next, d.type)
  })

  return { week: { days }, changed }
}

/**
 * Fill a week from a caller-supplied, already-ordered candidate pool, honouring
 * each day's type and the no-repeat rule. This is the SAME day-fill `generateWeek`
 * does (busy days take quick dinners with the shortest-available fallback, out
 * days stay empty, no recipe repeats), but it walks the pool order we hand it
 * rather than re-ranking. The lean-more tool uses it to fill from a term-biased
 * pool so matching recipes land first while the planner's order decides the rest.
 */
function fillFromPool(
  week: PlannedWeek,
  pool: Array<PlannerRecipe>,
  profile: PlannerProfile,
): PlannedWeek {
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

export class WeekSession {
  private week: PlannedWeek
  private readonly recipes: Array<PlannerRecipe>
  private readonly profile: PlannerProfile
  private readonly swipes: Array<PlannerSwipe>
  private readonly seed?: number
  private readonly penalties?: SoftPenalties
  private readonly buildMatcher?: TermMatcherFactory
  private readonly initialRefs: string
  /** Matchers accumulated by exclude — sticky for the rest of the session. */
  private readonly excludedMatchers: Array<TermMatcher> = []

  constructor(init: WeekSessionInit) {
    this.week = { days: init.week.days.map((d) => ({ ...d })) }
    this.recipes = init.recipes
    this.profile = init.profile
    this.swipes = init.swipes
    this.seed = init.seed
    this.penalties = init.penalties
    this.buildMatcher = init.buildMatcher
    this.initialRefs = this.refKey()
  }

  /** A stable join of the current day refs, for change detection. */
  private refKey(): string {
    return this.week.days.map((d) => d.recipeRef).join('|')
  }

  /** The current working week (a fresh copy, safe to serialise to the client). */
  getWeek(): PlannedWeek {
    return { days: this.week.days.map((d) => ({ ...d })) }
  }

  /** Whether the week moved at all since the session opened. */
  hasChanged(): boolean {
    return this.refKey() !== this.initialRefs
  }

  /** Map ids -> recipes once per call (the catalogue is read-only). */
  private byRef(): Map<string, PlannerRecipe> {
    return new Map(this.recipes.map((r) => [r.id, r]))
  }

  /** Recipes that pass every exclude matcher applied this session. */
  private eligibleRecipes(): Array<PlannerRecipe> {
    if (this.excludedMatchers.length === 0) return this.recipes
    return this.recipes.filter((r) => !this.excludedMatchers.some((m) => m(r)))
  }

  /** Build a ranked pool from eligible recipes only. */
  private rankedEligiblePool(): Array<PlannerRecipe> {
    return rankedPool(
      this.eligibleRecipes(),
      this.profile,
      this.swipes,
      this.seed,
      this.penalties,
    )
  }

  /** A plain-language read of the current week, for the get_week tool. */
  describe(): string {
    const lines = this.week.days.map((d) =>
      d.recipeRef ? `${d.day}: ${d.meal}` : `${d.day}: (eating out)`,
    )
    return lines.join('\n')
  }

  /** Clear the named days (eating out / skipping). */
  skipDays(days: Array<string>): SessionEdit {
    const targets = new Set(days)
    if (targets.size === 0) {
      return { changed: false, summary: 'Which day are you eating out?' }
    }
    const changed = this.week.days.some(
      (d) => targets.has(d.day) && Boolean(d.recipeRef || d.meal),
    )
    this.week = {
      days: this.week.days.map((d) =>
        targets.has(d.day)
          ? { day: d.day, meal: '', recipeRef: '', type: 'out' }
          : d,
      ),
    }
    return {
      changed,
      summary: changed
        ? `${days.join(', ')} — eating out.`
        : `${days.join(', ')} was already clear.`,
    }
  }

  /** Swap the named days for their next-best pick by preference. */
  swapDays(days: Array<string>): SessionEdit {
    const targets =
      days.length > 0
        ? new Set(days)
        : new Set(
            [this.week.days[this.week.days.length - 1]?.day].filter(
              Boolean,
            ) as Array<string>,
          )
    const pool = this.rankedEligiblePool()
    const { week: next, changed } = repickDays(this.week, targets, pool, true)
    this.week = next
    return {
      changed,
      summary: changed
        ? `Picked something different for ${[...targets].join(', ')}.`
        : 'No other option for that day.',
    }
  }

  /** Drop every recipe matching `term` and replan the affected days. */
  async exclude(term: string): Promise<SessionEdit> {
    const cleaned = term.trim()
    if (!this.buildMatcher) {
      return {
        changed: false,
        summary: `Can't filter out "${cleaned}" right now.`,
      }
    }
    const matches = await this.buildMatcher(cleaned)
    if (!matches) {
      return {
        changed: false,
        summary: `Not sure what "${cleaned}" means — try a simpler word?`,
      }
    }
    this.excludedMatchers.push(matches)
    const filtered = this.eligibleRecipes()
    const pool = rankedPool(
      filtered,
      this.profile,
      this.swipes,
      this.seed,
      this.penalties,
    )
    const map = this.byRef()
    const affected = new Set(
      this.week.days
        .filter((d) => {
          const r = d.recipeRef ? map.get(d.recipeRef) : null
          return r ? matches(r) : false
        })
        .map((d) => d.day),
    )
    if (affected.size === 0) {
      return {
        changed: false,
        summary: `Nothing with ${cleaned} this week already.`,
      }
    }
    const { week: next, changed } = repickDays(this.week, affected, pool)
    this.week = next
    return {
      changed,
      summary: changed
        ? `Removed ${cleaned} from ${affected.size} dinner${affected.size === 1 ? '' : 's'}.`
        : `Couldn't swap those — not enough ${cleaned}-free options.`,
    }
  }

  /** Bias the week toward `term`, floating matching recipes to the front. */
  async leanMore(term: string): Promise<SessionEdit> {
    const cleaned = term.trim()
    if (!this.buildMatcher) {
      return {
        changed: false,
        summary: `Can't add more "${cleaned}" right now.`,
      }
    }
    const matches = await this.buildMatcher(cleaned)
    if (!matches) {
      return {
        changed: false,
        summary: `Not sure what "${cleaned}" means — try a simpler word?`,
      }
    }
    const map = this.byRef()
    const matchesBefore = this.week.days.filter((d) => {
      const r = d.recipeRef ? map.get(d.recipeRef) : null
      return r ? matches(r) : false
    }).length

    const ranked = rankRecipes(
      this.eligibleRecipes(),
      this.profile,
      this.swipes,
      {
        seed: this.seed,
        penalties: this.penalties,
      },
    )
    const matchingPool = ranked.filter((r) => matches(r))
    if (matchingPool.length === 0) {
      return {
        changed: false,
        summary: `Don't have any more ${cleaned} dinners to add.`,
      }
    }

    const rest = ranked.filter((r) => !matches(r))
    const biasedPool = [...matchingPool, ...rest]
    const before = this.refKey()
    this.week = fillFromPool(this.week, biasedPool, this.profile)
    const changed = this.refKey() !== before

    const matchesAfter = this.week.days.filter((d) => {
      const r = d.recipeRef ? map.get(d.recipeRef) : null
      return r ? matches(r) : false
    }).length
    const gained = matchesAfter - matchesBefore
    const filled = this.week.days.filter((d) => d.recipeRef).length

    let summary: string
    if (gained > 0) {
      summary = `Added more ${cleaned} — now ${matchesAfter} of ${filled} dinners.`
    } else if (matchesAfter > 0) {
      summary = `Already ${matchesAfter} ${cleaned} dinner${matchesAfter === 1 ? '' : 's'} — can't add more without repeating.`
    } else {
      summary = `Don't have any more ${cleaned} dinners to add.`
    }
    return { changed, summary }
  }

  /** Replace the named days with quicker dinners (prep <= the busy cap). */
  makeQuicker(days: Array<string>): SessionEdit {
    const targets =
      days.length > 0
        ? new Set(days)
        : new Set(this.week.days.filter((d) => d.recipeRef).map((d) => d.day))
    if (targets.size === 0) {
      return { changed: false, summary: 'No dinners to speed up.' }
    }
    const filledDays = this.week.days.filter((d) => d.recipeRef).length
    const wholeWeek = targets.size === filledDays && filledDays > 0
    const quickPool = this.rankedEligiblePool().filter(fitsBusy)
    const { week: next, changed } = repickDays(
      this.week,
      targets,
      quickPool,
      true,
    )
    this.week = {
      days: next.days.map((d) =>
        targets.has(d.day) && d.recipeRef ? { ...d, type: 'busy' } : d,
      ),
    }
    return {
      changed,
      summary: changed
        ? wholeWeek
          ? 'Switched to quicker dinners all week.'
          : `Switched to quicker dinners for ${[...targets].join(', ')}.`
        : "Already as quick as they'll get.",
    }
  }

  /** Set a day's type: 'out' clears it, 'home'/'busy' (re)fills it if empty. */
  setDayType(day: string, type: DayType): SessionEdit {
    const exists = this.week.days.some((d) => d.day === day)
    if (!exists) {
      return { changed: false, summary: `${day} is not in this week.` }
    }
    if (type === 'out') return this.skipDays([day])
    const current = this.week.days.find((d) => d.day === day)
    this.week = {
      days: this.week.days.map((d) => (d.day === day ? { ...d, type } : d)),
    }
    if (current && !current.recipeRef) return this.addMeal(day)
    // Already has a meal: if it must now be quick, re-pick a quick dinner.
    if (type === 'busy') return this.makeQuicker([day])
    return { changed: true, summary: `${day} is a normal home-cooking night.` }
  }

  /** Add a dinner to an empty day (the top unused pick that fits its type). */
  addMeal(day: string): SessionEdit {
    const target = this.week.days.find((d) => d.day === day)
    if (!target)
      return { changed: false, summary: `${day} is not in this week.` }
    if (target.recipeRef) {
      return { changed: false, summary: `${day} already has a dinner.` }
    }
    const used = new Set(
      this.week.days.filter((d) => d.recipeRef).map((d) => d.recipeRef),
    )
    const pool = this.rankedEligiblePool()
    const type: DayType = target.type === 'busy' ? 'busy' : 'home'
    const wantsQuick = type === 'busy'
    let pick = pool.find((r) => !used.has(r.id) && (!wantsQuick || fitsBusy(r)))
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
    if (!pick) {
      return { changed: false, summary: `No dinner left to add to ${day}.` }
    }
    this.week = {
      days: this.week.days.map((d) =>
        d.day === day ? dayFor(d.day, pick, type) : d,
      ),
    }
    return { changed: true, summary: `Added a dinner to ${day}.` }
  }

  /** Rebuild the whole week from scratch, preserving each day's type. */
  regenerate(): SessionEdit {
    const before = this.refKey()
    const dayTypes = this.week.days.map((d) => d.type)
    const fresh = generateWeek(
      this.eligibleRecipes(),
      this.profile,
      this.swipes,
      {
        seed: this.seed,
        days: this.week.days.length || 7,
        dayTypes: dayTypes.map((t) => t ?? 'home'),
        penalties: this.penalties,
      },
    )
    // Keep the session's own day labels (the planner uses Monday-first labels,
    // which match, but be defensive about a shorter/longer stored week).
    this.week = {
      days: this.week.days.map((d, i) => {
        const next = fresh.days[i]
        return next ? { ...next, day: d.day } : d
      }),
    }
    const changed = this.refKey() !== before
    return {
      changed,
      summary: changed
        ? 'Fresh week of dinners.'
        : "Couldn't find a different mix — nothing changed.",
    }
  }
}

export { WEEK_DAYS }
