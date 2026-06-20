/**
 * Anonymous swipe store.
 *
 * A not-signed-in visitor can swipe the opening deck without any account. Their
 * swipes are held client-side (localStorage) until they choose "Save my week",
 * sign in (or use the demo skip), and we persist the batch via finishOnboarding.
 *
 * Storage is a single JSON array of `{ recipeId, like }` under one key. The
 * read/write/clear helpers are pure (they take the storage object) so they can
 * run in tests against an in-memory stub, and are no-ops when storage is absent
 * (SSR, private-mode quota errors) rather than throwing into the swipe path.
 */

export interface AnonSwipe {
  recipeId: string
  like: boolean
}

export const ANON_SWIPES_KEY = 'smartcart.anon-swipes.v1'

/** A minimal Storage shape so the helpers can be unit-tested without the DOM. */
export interface SwipeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** Resolve the browser's localStorage, or null on the server / when blocked. */
export function browserStorage(): SwipeStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // Accessing localStorage can throw in some privacy modes.
    return null
  }
}

function isAnonSwipe(value: unknown): value is AnonSwipe {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnonSwipe).recipeId === 'string' &&
    typeof (value as AnonSwipe).like === 'boolean'
  )
}

/** Read the stored swipes. Returns [] for missing, malformed, or absent storage. */
export function readAnonSwipes(
  storage: SwipeStorage | null = browserStorage(),
): Array<AnonSwipe> {
  if (!storage) return []
  let raw: string | null
  try {
    raw = storage.getItem(ANON_SWIPES_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAnonSwipe)
  } catch {
    return []
  }
}

/**
 * Persist the full swipe list, replacing whatever was there. The last swipe for
 * a given recipe wins (a user can change their mind by swiping it again), and
 * order is preserved by recency. A no-op when storage is unavailable.
 */
export function writeAnonSwipes(
  swipes: ReadonlyArray<AnonSwipe>,
  storage: SwipeStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(ANON_SWIPES_KEY, JSON.stringify(dedupeByRecipe(swipes)))
  } catch {
    // Quota or serialization failure: drop silently, never break the swipe.
  }
}

/** Clear the anonymous swipes (called once they've been persisted on sign-in). */
export function clearAnonSwipes(
  storage: SwipeStorage | null = browserStorage(),
): void {
  if (!storage) return
  try {
    storage.removeItem(ANON_SWIPES_KEY)
  } catch {
    // ignore
  }
}

/**
 * Collapse repeat swipes on the same recipe down to the latest decision, keeping
 * the order of first appearance stable. Pure; used by writeAnonSwipes and safe to
 * reuse when merging a fresh swipe into a held batch.
 */
export function dedupeByRecipe(
  swipes: ReadonlyArray<AnonSwipe>,
): Array<AnonSwipe> {
  const latest = new Map<string, boolean>()
  for (const s of swipes) latest.set(s.recipeId, s.like)
  return Array.from(latest, ([recipeId, like]) => ({ recipeId, like }))
}
