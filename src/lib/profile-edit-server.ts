import { createServerFn } from '@tanstack/react-start'

/**
 * Data-points editor: read + write the signed-in household's STATED preferences
 * and their MANUAL skip-day override, so the Profile tab can show "what Souso
 * knows about you" and let the household adjust it (#data-points).
 *
 * The user's words: "users can see their own data points and adjust them too.
 * Maybe we have defaults based on their preferences, but they can manually
 * adjust, or click to use our auto inferred one. These settings are used for
 * each new week."
 *
 * Two halves, mirroring store-pref-server's split:
 *  - Pure glue (the editable-field shape + the validate/merge helper), unit
 *    tested with no DB.
 *  - createServerFns that wrap D1 + auth around the glue, with all server-only
 *    access behind dynamic import() inside the handler so nothing leaks into the
 *    client bundle.
 *
 * Storage: everything lives on the existing `household.profile` JSON column (no
 * new table, no migration). The planner already reads `household.profile`, so
 * every edit flows into the next week's generation automatically — diet +
 * dislikes are hard filters, liked/disliked cuisines + goals are soft weights,
 * and `skipDays` (manual override) wins over the auto-inferred skip-days inside
 * generatePlanForHousehold (see resolveSkipDays in planner/skip-days).
 */

/** Stores import this for typing without pulling the server graph. */
export interface EditableProfile {
  /** Cuisines the household likes — a soft planner up-weight. */
  cuisinesLiked: Array<string>
  /** Cuisines the household hates — a soft planner down-weight. */
  cuisinesDisliked: Array<string>
  /** Ingredients to avoid — the user's own words, shown as "no X". */
  dislikes: Array<string>
  /** Dietary restriction labels (Dairy free, Gluten free, Vegan, ...). */
  diet: Array<string>
  /** Soft goals (Eat balanced, Pay less, ...). */
  goals: Array<string>
  /**
   * MANUAL skip-day override (0=Mon..6=Sun). null = "use Souso's auto-inferred
   * skip-days"; an array (incl. empty) = "use exactly these days". The empty
   * array is an explicit "I skip no days" that suppresses inference.
   */
  skipDays: Array<number> | null
}

/** A patch to the editable profile — every field optional. */
export type ProfilePatch = Partial<EditableProfile>

/** The diet exclusion map mirrors onboarding-mapping so the planner stays
 * consistent when diet is edited after onboarding. Kept in sync deliberately. */
const EXCLUSION_DIETS: Record<string, ReadonlyArray<string>> = {
  'dairy free': ['milk', 'cheese', 'butter', 'cream', 'yoghurt', 'yogurt'],
  'gluten free': ['wheat', 'flour', 'bread', 'pasta', 'noodle', 'couscous'],
  // Kept in sync with onboarding-mapping: every pork form, EN + NL (#422).
  porkless: [
    'pork',
    'ham',
    'bacon',
    'gammon',
    'chorizo',
    'lardon',
    'pancetta',
    'prosciutto',
    'spek',
  ],
}

/** Tag-diets the planner's veg gate understands, strictest first. */
const TAG_DIETS: ReadonlyArray<string> = ['vegan', 'vegetarian']

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Clean a free-text string list: trim, drop empties, dedupe case-insensitively
 * while preserving the FIRST-seen display casing. */
function cleanList(input: unknown): Array<string> {
  if (!Array.isArray(input)) return []
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** Clean a weekday-index list: integers in 0..6, deduped, sorted ascending. */
export function cleanSkipDays(input: unknown): Array<number> {
  if (!Array.isArray(input)) return []
  const valid = input.filter(
    (d): d is number =>
      typeof d === 'number' && Number.isInteger(d) && d >= 0 && d < 7,
  )
  return Array.from(new Set(valid)).sort((a, b) => a - b)
}

/**
 * Merge a validated patch into an existing household.profile JSON, returning the
 * NEW profile object to persist (pure — no DB, no mutation of the input).
 *
 * The load-bearing derivation: editing `diet` + `dislikes` must keep the
 * planner's HARD filters (`allergies` + `diet` string) in sync, exactly the way
 * onboarding-mapping derives them, so an after-onboarding edit filters the same
 * as onboarding did. Likewise a like wins over a hate for the same cuisine.
 *
 * Only fields present on the patch are touched; everything else on the existing
 * profile is preserved untouched (profile is NOT NULL, base is {} not null).
 */
export function mergeProfilePatch(
  existing: Record<string, unknown>,
  patch: ProfilePatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing }

  // Cuisines: clean both, then strip any cuisine that sits in both lists from
  // the disliked side (a like wins), matching onboarding-mapping.
  if (
    patch.cuisinesLiked !== undefined ||
    patch.cuisinesDisliked !== undefined
  ) {
    const liked = cleanList(patch.cuisinesLiked ?? existing.cuisinesLiked)
    const likedKeys = new Set(liked.map((c) => c.toLowerCase()))
    const disliked = cleanList(
      patch.cuisinesDisliked ?? existing.cuisinesDisliked,
    ).filter((c) => !likedKeys.has(c.toLowerCase()))
    next.cuisinesLiked = liked
    next.cuisinesDisliked = disliked
  }

  // Diet + dislikes drive the planner's hard gates, so recompute `diet` (the
  // single tag-diet string) and `allergies` (ingredient exclusions) whenever
  // either changes — reading the post-patch values for both.
  if (patch.diet !== undefined || patch.dislikes !== undefined) {
    // Diet reads the multi-select labels (dietLabels), falling back to the old
    // single diet string for profiles written before this editor existed.
    const dietLabels = cleanList(
      patch.diet ?? existing.dietLabels ?? existing.diet,
    )
    const dislikes = cleanList(patch.dislikes ?? existing.dislikes)

    const dietLabelsLower = dietLabels.map(normalise)
    const dislikeExclusions = dislikes.map(normalise).filter(Boolean)
    const dietExclusions = dietLabelsLower.flatMap(
      (d) => EXCLUSION_DIETS[d] ?? [],
    )
    const allergies = Array.from(
      new Set([...dislikeExclusions, ...dietExclusions]),
    )

    // `diet` on the profile is the single string the veg gate reads. We keep
    // the multi-select labels on `dietLabels` for display + re-derivation.
    next.dietLabels = dietLabels
    next.diet = TAG_DIETS.find((d) => dietLabelsLower.includes(d))
    next.dislikes = dislikeExclusions
    next.allergies = allergies
  }

  if (patch.goals !== undefined) {
    next.goals = cleanList(patch.goals)
  }

  if (patch.skipDays !== undefined) {
    // null = "use auto-inferred". An array (incl. empty) = explicit override.
    next.skipDays =
      patch.skipDays === null ? null : cleanSkipDays(patch.skipDays)
  }

  return next
}

/** Read one string-array field off a profile JSON, tolerating any stored shape. */
function readList(value: unknown): Array<string> {
  return cleanList(value)
}

/**
 * Project a stored profile JSON down to the editable shape the UI reads. Diet
 * reads `dietLabels` (the multi-select) and falls back to the single `diet`
 * string for households onboarded before this editor existed.
 */
function toEditable(profile: Record<string, unknown>): EditableProfile {
  const dietLabels = readList(profile.dietLabels)
  const dietFallback = readList(profile.diet)
  const skipDays = profile.skipDays
  return {
    cuisinesLiked: readList(profile.cuisinesLiked),
    cuisinesDisliked: readList(profile.cuisinesDisliked),
    dislikes: readList(profile.dislikes),
    diet: dietLabels.length ? dietLabels : dietFallback,
    goals: readList(profile.goals),
    skipDays: Array.isArray(skipDays) ? cleanSkipDays(skipDays) : null,
  }
}

/**
 * Read the editable data points for the signed-in household (null if not signed
 * in / not onboarded).
 */
export const getProfileEditor = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EditableProfile | null> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) return null
    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const profile = rows[0]?.profile
    if (!profile) return null
    return toEditable(profile)
  },
)

/**
 * Merge a patch into the household.profile JSON. Household-scoped (the signed-in
 * user's household), validated via mergeProfilePatch. Returns the new editable
 * shape so the client can reflect it. Throws if not signed in / not onboarded.
 *
 * These settings feed every new week: the planner reads household.profile in
 * generatePlanForHousehold, so the next generated week honours the edit with no
 * extra wiring.
 */
export const updateHouseholdProfile = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown): { patch: ProfilePatch } => {
    if (
      typeof d !== 'object' ||
      d === null ||
      typeof (d as { patch?: unknown }).patch !== 'object' ||
      (d as { patch?: unknown }).patch === null
    ) {
      throw new Error('Invalid profile patch')
    }
    return d as { patch: ProfilePatch }
  })
  .handler(async ({ data }): Promise<EditableProfile> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const rows = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const row = rows[0]
    if (!row) throw new Error('No household, onboard first')

    const merged = mergeProfilePatch(row.profile, data.patch)

    await db
      .update(household)
      .set({
        profile: merged,
        updatedAt: new Date(),
      })
      .where(eq(household.id, row.id))

    return toEditable(merged)
  })

/** The auto-inferred skip-days surface for the editor (#data-points). */
export interface InferredSkipDays {
  /** The weekdays Souso inferred the household skips (0=Mon..6=Sun). */
  inferred: Array<number>
  /** The household's current manual override, or null (use auto-inferred). */
  manual: Array<number> | null
  /** How many past plans the inference had to work with (for honest copy). */
  planCount: number
}

/**
 * Compute what Souso INFERRED about the household's skip-days from their recent
 * plans, alongside the current manual override. Powers the "We noticed you skip
 * Fridays — use this?" affordance. Reads the same recent-plans window the
 * planner uses, so the suggestion matches what generation would actually do.
 */
export const getInferredSkipDays = createServerFn({ method: 'GET' }).handler(
  async (): Promise<InferredSkipDays | null> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) return null
    const { getDb } = await import('../db/client')
    const { household, mealPlan } = await import('../db/schema')
    const { inferSkipDays } = await import('./planner/skip-days')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()

    const hhRows = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = hhRows[0]
    if (!hh) return null

    const planRows = await db
      .select({ plan: mealPlan.plan })
      .from(mealPlan)
      .where(eq(mealPlan.householdId, hh.id))
      .orderBy(desc(mealPlan.createdAt))
      .limit(8)

    const inferred = inferSkipDays(planRows.map((p) => p.plan.days))
    const storedManual = hh.profile.skipDays
    return {
      inferred: Array.from(inferred).sort((a, b) => a - b),
      manual: Array.isArray(storedManual) ? cleanSkipDays(storedManual) : null,
      planCount: planRows.length,
    }
  },
)
