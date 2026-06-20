import { createServerFn } from '@tanstack/react-start'
import type { DeckCard } from './recsys-data'
import type { InferredTaste } from './recsys/types'
import { deriveBadges } from './badges'
import type { Badge } from './badges'
import type { OnboardingDraft } from '#/components/onboarding/form-state'

interface SwipeInput {
  recipeId: string
  like: boolean
}

/** The next batch of swipe cards, chosen by the adaptive recommender. */
export const getOnboardingDeck = createServerFn({ method: 'POST' })
  .inputValidator((d: { swipes: Array<SwipeInput>; k?: number }) => d)
  .handler(async ({ data }): Promise<Array<DeckCard>> => {
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { recipes, cards } = await loadCatalogue()
    // Live onboarding always uses the configured default algorithm + weights.
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)
    const deck = rec.nextDeck(data.swipes, data.k ?? 8)
    return deck.flatMap((r) => {
      const c = cards.get(r.id)
      return c ? [c] : []
    })
  })

export interface OnboardingResult {
  householdId: string
  taste: InferredTaste
}

/**
 * Persist the onboarding swipes, infer the taste profile, and write it to the
 * household (creating one if needed). Returns the inferred taste so the app can
 * show "this is what we learned" immediately.
 */
interface HouseholdSizeInput {
  adults: number
  children: number
}

export const finishOnboarding = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: {
      swipes: Array<SwipeInput>
      householdSize?: HouseholdSizeInput
      cookDays?: Array<number>
    }) => d,
  )
  .handler(async ({ data }): Promise<OnboardingResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipeSwipe } = await import('../db/schema')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { normalizeCookDays, clampHouseholdCount } =
      await import('./onboarding-rhythm')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const { recipes } = await loadCatalogue()
    const taste = makeRecommender(DEFAULT_ALGORITHM, recipes).explain(
      data.swipes.map((s) => ({ recipeId: s.recipeId, like: s.like })),
    )
    // cookDays drives the default weekly rhythm; empty selection = cook every
    // day. Merge into profile alongside the taste fields, never clobbering them.
    const cookDays = normalizeCookDays(data.cookDays ?? [])
    const profile = {
      dislikedCuisines: taste.dislikedCuisines,
      dislikes: taste.dislikedIngredients,
      lovedTastes: [
        ...taste.lovedCuisines.map((c) => c.cuisine),
        ...taste.lovedIngredients,
      ],
      cookDays,
    }

    // Household size lands on the dedicated columns, not the profile json.
    const adults = clampHouseholdCount(data.householdSize?.adults ?? 1, 1)
    const children = clampHouseholdCount(data.householdSize?.children ?? 0, 0)

    const existing = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    let householdId = existing[0]?.id
    if (householdId) {
      await db
        .update(household)
        .set({ profile, adults, children, updatedAt: new Date() })
        .where(eq(household.id, householdId))
    } else {
      householdId = crypto.randomUUID()
      await db.insert(household).values({
        id: householdId,
        ownerId: user.id,
        profile,
        adults,
        children,
        updatedAt: new Date(),
      })
    }

    if (data.swipes.length) {
      await db.insert(recipeSwipe).values(
        data.swipes.map((s) => ({
          id: crypto.randomUUID(),
          householdId: householdId,
          recipeId: s.recipeId,
          direction: s.like ? 'like' : 'dislike',
          round: 0,
        })),
      )
    }
    return { householdId, taste }
  })

/**
 * Complete FORM onboarding (PRD #104): persist every form answer to the
 * household + profile, then generate the first week from those answers and
 * return its plan id so the flow can route straight to /week?plan=<id>.
 *
 * The form is now the data source (the swipe deck is no longer the onboarding
 * path), so this is where the explicit answers become the persisted shape the
 * planner filters on:
 *   - diet + dislikes -> HARD filters (planner's veg-tag gate + ingredient
 *     allergy gate; see draftToHousehold for the label->filter mapping).
 *   - household (adults/children) -> portions.
 *   - equipment + goals -> SOFT / best-effort weights (carried on the profile;
 *     the planner uses goals as a soft nudge today, equipment is a seam).
 *
 * Profile is NOT NULL: we MERGE over any existing profile, never set null, so a
 * redo-onboarding keeps fields the new draft does not touch.
 */
export interface CompleteOnboardingResult {
  householdId: string
  planId: string
}

export const completeOnboarding = createServerFn({ method: 'POST' })
  .inputValidator((d: { draft: OnboardingDraft }) => d)
  .handler(async ({ data }): Promise<CompleteOnboardingResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { draftToHousehold } = await import('./onboarding-mapping')
    const { generatePlanForHousehold } = await import('./planner-core')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const mapped = draftToHousehold(data.draft)

    const existing = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)

    // Merge over any existing profile so a redo keeps untouched fields; the
    // mapped fields win. profile is NOT NULL, so the spread base is {} not null.
    const mergedProfile = { ...(existing[0]?.profile ?? {}), ...mapped.profile }

    let householdId = existing[0]?.id
    if (householdId) {
      await db
        .update(household)
        .set({
          profile: mergedProfile,
          adults: mapped.adults,
          children: mapped.children,
          // Only overwrite the store when the form gave a real one; otherwise
          // keep whatever the household already had (the column is NOT NULL).
          ...(mapped.preferredStore
            ? { preferredStore: mapped.preferredStore }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(household.id, householdId))
    } else {
      householdId = crypto.randomUUID()
      await db.insert(household).values({
        id: householdId,
        ownerId: user.id,
        profile: mergedProfile,
        adults: mapped.adults,
        children: mapped.children,
        ...(mapped.preferredStore
          ? { preferredStore: mapped.preferredStore }
          : {}),
        updatedAt: new Date(),
      })
    }

    // Generate the first week from the just-persisted profile (hard filters +
    // soft weights are read off the household row inside the planner core).
    const { planId } = await generatePlanForHousehold(householdId)
    return { householdId, planId }
  })

/**
 * Reset onboarding: clear the household's swipes + learned taste so the user can
 * swipe again from scratch. Keeps the household row. Useful to re-onboard a fresh
 * person on stage during the demo.
 */
export const resetOnboarding = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true }> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')
    const { getDb } = await import('../db/client')
    const { household, recipeSwipe } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const householdId = rows[0]?.id
    if (householdId) {
      await db
        .delete(recipeSwipe)
        .where(eq(recipeSwipe.householdId, householdId))
      await db
        .update(household)
        // profile is NOT NULL (defaults to {}); reset to empty, not null.
        .set({ profile: {}, updatedAt: new Date() })
        .where(eq(household.id, householdId))
    }
    return { ok: true }
  },
)

/** Does the signed-in user already have a household (i.e. has onboarded)? */
export const hasHousehold = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) return false
    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    return rows.length > 0
  },
)

export interface HouseholdSummary {
  lovedTastes: Array<string>
  dislikedCuisines: Array<string>
  dislikes: Array<string>
  badges: Array<Badge>
}

/** The signed-in household's inferred taste + badges (null if not onboarded). */
export const getHouseholdSummary = createServerFn({ method: 'GET' }).handler(
  async (): Promise<HouseholdSummary | null> => {
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
    return {
      lovedTastes: profile.lovedTastes ?? [],
      dislikedCuisines: profile.dislikedCuisines ?? [],
      dislikes: profile.dislikes ?? [],
      badges: deriveBadges(profile),
    }
  },
)
