import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { deriveBadges } from './badges'
import type { Badge } from './badges'

/** Who can see the admin console. */
const ADMIN_EMAILS = ['tech@discopenguin.com']

async function adminUser() {
  const { getSessionUser } = await import('./server-auth')
  const u = await getSessionUser()
  return u && ADMIN_EMAILS.includes(u.email) ? u : null
}

export const isAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => Boolean(await adminUser()),
)

/** beforeLoad guard for /admin: non-admins are bounced to the home page. */
export async function requireAdminBeforeLoad(): Promise<void> {
  if (!(await isAdmin())) throw redirect({ to: '/' })
}

export interface AdminUserRow {
  userId: string
  email: string
  householdId: string | null
  swipes: number
  badges: Array<Badge>
}

export const listUsers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AdminUserRow>> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe } = await import('../db/schema')
    const { eq, count } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({
        userId: user.id,
        email: user.email,
        householdId: household.id,
        profile: household.profile,
      })
      .from(user)
      .leftJoin(household, eq(household.ownerId, user.id))
    const counts = await db
      .select({ hid: recipeSwipe.householdId, n: count() })
      .from(recipeSwipe)
      .groupBy(recipeSwipe.householdId)
    const byHid = new Map(counts.map((c) => [c.hid, c.n]))
    return rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      householdId: r.householdId,
      swipes: r.householdId ? (byHid.get(r.householdId) ?? 0) : 0,
      badges: r.profile ? deriveBadges(r.profile) : [],
    }))
  },
)

export interface Datapoint {
  recipeTitle: string
  cuisine: string | null
  direction: string
  at: string
}
export interface UserDatapoints {
  email: string
  badges: Array<Badge>
  lovedTastes: Array<string>
  dislikes: Array<string>
  swipes: Array<Datapoint>
}

export const getUserDatapoints = createServerFn({ method: 'POST' })
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data }): Promise<UserDatapoints | null> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe, recipe } =
      await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()
    const u = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1)
    )[0]
    if (!u) return null
    const hh = (
      await db
        .select({ id: household.id, profile: household.profile })
        .from(household)
        .where(eq(household.ownerId, data.userId))
        .limit(1)
    )[0]
    const swipes = hh
      ? await db
          .select({
            recipeTitle: recipe.title,
            cuisine: recipe.cuisine,
            direction: recipeSwipe.direction,
            at: recipeSwipe.createdAt,
          })
          .from(recipeSwipe)
          .innerJoin(recipe, eq(recipe.id, recipeSwipe.recipeId))
          .where(eq(recipeSwipe.householdId, hh.id))
          .orderBy(desc(recipeSwipe.createdAt))
      : []
    const profile = hh?.profile
    return {
      email: u.email,
      badges: profile ? deriveBadges(profile) : [],
      lovedTastes: profile?.lovedTastes ?? [],
      dislikes: profile?.dislikes ?? [],
      swipes: swipes.map((s) => ({
        recipeTitle: s.recipeTitle,
        cuisine: s.cuisine,
        direction: s.direction,
        at: s.at instanceof Date ? s.at.toISOString() : String(s.at),
      })),
    }
  })
