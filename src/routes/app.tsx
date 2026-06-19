import {
  createFileRoute,
  redirect,
  useRouter,
  Link,
} from '@tanstack/react-router'
import { ShoppingCart, LogOut, RefreshCw } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { hasHousehold, getHouseholdSummary } from '#/lib/onboarding-server'
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
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    await router.navigate({ to: '/' })
  }

  return (
    <div className="min-h-screen">
      <header className="border-border mx-auto flex max-w-4xl items-center justify-between border-b px-6 py-4">
        <span className="flex items-center gap-2 font-bold">
          <ShoppingCart className="text-primary h-6 w-6" />
          Smart Cart
        </span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground hidden text-sm sm:inline">
            {user.email}
          </span>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
        <div className="space-y-2">
          <Badge variant="primary">Your taste profile</Badge>
          <h1 className="text-3xl font-bold tracking-tight">
            Here's what we learned about you
          </h1>
          <p className="text-muted-foreground">
            Built from your swipes. It sharpens every week as you cook and rate.
          </p>
        </div>

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

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
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
          <Card>
            <CardHeader>
              <CardTitle>Your week</CardTitle>
              <CardDescription>
                Seven dinners picked for you, ready to become one AH or Jumbo
                basket.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button disabled>Plan my week (coming next)</Button>
              <Link to="/onboarding" className="block">
                <Button variant="ghost" size="sm">
                  <RefreshCw className="h-4 w-4" />
                  Swipe more recipes
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
