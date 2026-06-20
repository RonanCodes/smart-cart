import { createServerFn } from '@tanstack/react-start'
import type { DeckCard } from './recsys-data'
import type { InferredTaste } from './recsys/types'
import { deriveBadges } from './badges'
import type { Badge } from './badges'

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
export const finishOnboarding = createServerFn({ method: 'POST' })
  .inputValidator((d: { swipes: Array<SwipeInput> }) => d)
  .handler(async ({ data }): Promise<OnboardingResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipeSwipe } = await import('../db/schema')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const { recipes } = await loadCatalogue()
    const taste = makeRecommender(DEFAULT_ALGORITHM, recipes).explain(
      data.swipes.map((s) => ({ recipeId: s.recipeId, like: s.like })),
    )
    const profile = {
      dislikedCuisines: taste.dislikedCuisines,
      dislikes: taste.dislikedIngredients,
      lovedTastes: [
        ...taste.lovedCuisines.map((c) => c.cuisine),
        ...taste.lovedIngredients,
      ],
    }

    const existing = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    let householdId = existing[0]?.id
    if (householdId) {
      await db
        .update(household)
        .set({ profile, updatedAt: new Date() })
        .where(eq(household.id, householdId))
    } else {
      householdId = crypto.randomUUID()
      await db.insert(household).values({
        id: householdId,
        ownerId: user.id,
        profile,
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
    const { eq, sql } = await import('drizzle-orm')
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
        .set({ profile: sql`null`, updatedAt: new Date() })
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
