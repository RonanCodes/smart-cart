import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { LogOut, RefreshCw } from 'lucide-react'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { authClient } from '#/lib/auth-client'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import {
  hasHousehold,
  getHouseholdSummary,
  resetOnboarding,
} from '#/lib/onboarding-server'
import { generatePlan } from '#/lib/planner-server'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const ctx = await requireUserBeforeLoad()
    if (!(await hasHousehold())) throw redirect({ to: '/onboarding' })
    return ctx
  },
  loader: async () => ({ summary: await getHouseholdSummary() }),
  component: AppHome,
})

function AppHome() {
  const { user } = Route.useRouteContext()
  const { summary } = Route.useLoaderData()
  const navigate = useNavigate()
  const [planning, setPlanning] = useState(false)

  async function signOut() {
    await authClient.signOut()
    // Hard redirect (not router.navigate): forces a full server round-trip so the
    // route guards re-run with the cleared session cookie. A client navigate reused
    // cached session state and left you on the app. (In local dev the open-access
    // getSessionUser override keeps you signed in, so this only takes effect in prod.)
    window.location.href = '/'
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
        title="Here's what we learned about you"
        subtitle="Built from your swipes. It sharpens every week as you cook and rate."
        action={
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        }
      />

      <div className="space-y-8 px-5 pt-2">
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

        <div className="grid gap-5 sm:grid-cols-2">
          <Card ios>
            <CardHeader>
              <CardTitle>You gravitate to</CardTitle>
              <CardDescription>
                The flavours you swiped right on.
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
                  Swipe a few more to sharpen this.
                </span>
              )}
              {summary?.dislikes.map((t) => (
                <Badge key={t} variant="outline">
                  no {t}
                </Badge>
              ))}
            </CardContent>
          </Card>
          <Card ios>
            <CardHeader>
              <CardTitle>Your week</CardTitle>
              <CardDescription>
                Seven dinners picked for you, ready to become one AH or Jumbo
                basket.
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
        </div>
      </div>
    </AppShell>
  )
}
