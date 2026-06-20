import { useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { LogOut, RefreshCw, Shield } from 'lucide-react'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { authClient } from '#/lib/auth-client'
import { loadAppBootstrap, resetOnboarding } from '#/lib/onboarding-server'
import { generatePlan } from '#/lib/planner-server'
import { Button, buttonVariants } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/_authed/app')({
  // Auth + onboarding run ONCE in the shared `_authed` layout (#251); `user`
  // comes off route context (Route.useRouteContext) instead of a per-route guard.
  // Reuse the loader result on back-nav within 30s (#251).
  staleTime: 30_000,
  // ONE round-trip (#251): loadAppBootstrap composes getHouseholdSummary +
  // isAdmin server-side, replacing the two separate loader calls. The header
  // 'Admin' button still only renders for true admins (same /admin gate).
  loader: () => loadAppBootstrap(),
  component: AppHome,
})

function AppHome() {
  const { user } = Route.useRouteContext()
  const { summary, isAdmin } = Route.useLoaderData()
  const navigate = useNavigate()
  const [planning, setPlanning] = useState(false)

  async function signOut() {
    // Best-effort client sign-out, then ALWAYS hard-navigate to the server-side
    // /sign-out route. The server route is what actually clears the session
    // cookie (and redirects to '/'), so it works even if this client call hangs
    // or throws on mobile. try/finally guarantees the nav fires either way.
    // (In local dev the open-access getSessionUser override keeps you signed in,
    // so this only takes visible effect in prod.)
    try {
      await authClient.signOut()
    } finally {
      window.location.href = '/sign-out'
    }
  }

  async function planWeek() {
    setPlanning(true)
    try {
      const { planId } = await generatePlan()
      await navigate({ to: '/week', search: { plan: planId } })
    } catch {
      setPlanning(false)
    }
  }

  const [resetting, setResetting] = useState(false)
  async function resetAndOnboard() {
    setResetting(true)
    try {
      await resetOnboarding()
      // Full reload so the route loaders re-run with the cleared profile.
      window.location.href = '/onboarding'
    } catch {
      setResetting(false)
    }
  }

  return (
    <AppShell>
      <ScreenHeader
        title="Your week"
        subtitle="No plan yet. Plan your week and Souso turns it into one Albert Heijn or Jumbo basket."
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link
                to="/admin/users"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        }
      />

      <div className="space-y-8 px-5 pt-2">
        {/* Primary pre-plan action: this screen IS the Week tab before a plan exists. */}
        <Card ios>
          <CardHeader>
            <CardTitle>Plan your week</CardTitle>
            <CardDescription>
              Seven dinners picked for your taste, ready to become one basket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button disabled={planning} onClick={planWeek}>
              {planning ? 'Planning…' : 'Plan my week'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={resetting}
              onClick={resetAndOnboard}
            >
              <RefreshCw className="h-4 w-4" />
              {resetting ? 'Resetting…' : 'Reset & redo onboarding'}
            </Button>
          </CardContent>
        </Card>

        {/* Taste profile: context for the plan above, clearly secondary. */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              Here's what we learned about you
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Built from what you told us in onboarding. It sharpens every week
              as you cook and rate.
            </p>
          </div>

          <Badge variant="primary">Your taste profile · {user.email}</Badge>

          {summary && summary.badges.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {summary.badges.map((b) => (
                <span
                  key={b.label}
                  className="bg-secondary text-secondary-foreground inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
                >
                  <span className="text-lg">{b.emoji}</span>
                  {b.label}
                </span>
              ))}
            </div>
          )}

          <Card ios>
            <CardHeader>
              <CardTitle>You gravitate to</CardTitle>
              <CardDescription>
                The cuisines and tastes you told us.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {summary?.lovedTastes.length ? (
                summary.lovedTastes.map((t) => (
                  <Badge key={t} variant="primary">
                    {t}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground text-sm">
                  Tell us a few cuisines you love to sharpen this.
                </span>
              )}
              {summary?.dislikes.map((t) => (
                <Badge key={t} variant="outline">
                  no {t}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  )
}
