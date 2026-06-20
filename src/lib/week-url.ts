/**
 * Build the /week URL for a given plan revision. The shape matches the route's
 * `plan` search param exactly (`/week?plan=<encoded-id>`), so it round-trips
 * through the router's default search parser on a cold load.
 *
 * Used by the in-place swap flow (#236) to sync the URL via
 * `history.replaceState` WITHOUT re-running the route loader. A swap already
 * holds the new week in optimistic state, so a full loader reload (which would
 * fire the route's full-page WeekSkeleton pendingComponent and jump scroll) is
 * wrong; we only need the address bar to reflect the new plan id for
 * shareability and the back button.
 */
export function weekPlanUrl(planId: string): string {
  return `/week?plan=${encodeURIComponent(planId)}`
}
