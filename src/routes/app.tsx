import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ShoppingCart, LogOut } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { requireUserBeforeLoad } from '#/lib/route-guards'
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
  beforeLoad: requireUserBeforeLoad,
  component: AppHome,
})

function AppHome() {
  const { user } = Route.useRouteContext()
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
          <Badge variant="primary">You're signed in</Badge>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to Smart Cart
          </h1>
          <p className="text-muted-foreground">
            This is your home. Next: tell Smart Cart about your household, and
            it plans your week.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>1. Set up your household</CardTitle>
              <CardDescription>
                Size, allergies, diet, budget, favourite supermarket. The more
                it knows, the better it plans.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled>Start onboarding (coming next)</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Get your week</CardTitle>
              <CardDescription>
                A full week of dinners, picked for you, ready to become one AH
                or Jumbo cart.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" disabled>
                Plan my week (coming next)
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
