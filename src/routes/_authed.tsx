import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireAuthedBeforeLoad } from '#/lib/route-guards'

/**
 * Shared auth + onboarding guard for the gated app routes (#251).
 *
 * This pathless layout runs the session + household resolution ONCE in its
 * `beforeLoad` (via the single `resolveAuthContext` server fn) and passes
 * `{ user, hasHousehold }` down to its children through route context. Children
 * (/week, /shopping, /app) read that context instead of each re-calling the two
 * guard server fns in their own beforeLoad, which is what made every gated visit
 * fan out two extra guard round-trips.
 *
 * The guard preserves the exact prior behaviour:
 *   - a signed-out visitor is redirected to /sign-in server-side, before any
 *     gated page renders;
 *   - a signed-in but not-onboarded visitor is redirected to /onboarding.
 *
 * Pathless (`_authed`): it adds NO URL segment, so the children keep their
 * paths (/week, /shopping, /app) unchanged.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: () => requireAuthedBeforeLoad(),
  component: () => <Outlet />,
})
