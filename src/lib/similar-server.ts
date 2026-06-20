import { createServerFn } from '@tanstack/react-start'
import type { SimilarResult, SimilarSort } from './vectors/similar'

export interface SimilarInput {
  /** The recipe to find swaps for. */
  recipeId: string
  /** Re-rank the neighbours: 'similarity' (default), 'faster', or 'lighter'. */
  sort?: SimilarSort
  /** How many neighbours to return. Defaults to the similarRecipes default (5). */
  limit?: number
}

export interface SimilarResponse {
  /** The recipe we found swaps for, echoed back. */
  recipeId: string
  /** Valid swaps: the query recipe excluded, household hard filters applied. */
  neighbours: Array<SimilarResult>
}

/**
 * Nearest-neighbour swaps for a recipe, scoped to the signed-in household so the
 * results respect that household's allergies + diet hard filters. Reads recipe +
 * household.profile; writes nothing. Similarity is set-maths (similar-score.ts).
 *
 * Server-only: every server-only module (auth, db, the vectors modules) is
 * dynamically imported inside the handler so none of it leaks into the client
 * bundle. Mirrors the planner-server / onboarding-server pattern.
 */
export const getSimilarRecipes = createServerFn({ method: 'POST' })
  .inputValidator((d: SimilarInput) => d)
  .handler(async ({ data }): Promise<SimilarResponse> => {
    if (!data.recipeId) throw new Error('recipeId required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const { similarRecipes } = await import('./vectors/similar')
    const db = await getDb()

    // The hard filters are the household's, so a swap suggested to a vegetarian
    // household is always vegetarian. No household yet => empty profile (the hard
    // filter is permissive, so neighbours come back by pure similarity).
    const rows = await db
      .select({ profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const profile = rows[0]?.profile ?? {}

    const neighbours = await similarRecipes(
      data.recipeId,
      { allergies: profile.allergies, diet: profile.diet },
      { sort: data.sort, limit: data.limit },
    )
    return { recipeId: data.recipeId, neighbours }
  })
