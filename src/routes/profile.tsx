import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  User,
  LogOut,
  RefreshCw,
  Store,
  Bell,
  CircleHelp,
  Shield,
} from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { isAdmin } from '#/lib/admin-server'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { List, ListRow } from '#/components/ui/list'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/profile')({
  // Server-decide admin status so the 'Admin console' row only renders for true
  // admins. The isAdmin server fn reuses the same adminUser gate the /admin
  // route guards on, so the client never guesses.
  loader: async () => ({ isAdmin: await isAdmin() }),
  component: Profile,
})

/**
 * Profile tab — account + settings. Signed-out visitors get a sign-in CTA;
 * signed-in users see their email and an iOS grouped settings list. Doubles as
 * the in-app showcase of the List + Sheet shell primitives.
 */
function Profile() {
  const { data: session } = authClient.useSession()
  const { isAdmin } = Route.useLoaderData()
  const [helpOpen, setHelpOpen] = useState(false)

  async function signOut() {
    await authClient.signOut()
    // Hard redirect so the server re-renders with the cleared session cookie
    // (a client navigate left stale session state and did nothing). Local dev
    // open-access keeps you signed in, so this only takes effect in prod.
    window.location.href = '/'
  }

  if (!session?.user) {
    return (
      <AppShell>
        <ScreenHeader title="Profile" />
        <EmptyState
          icon={<User aria-hidden />}
          title="You're browsing as a guest"
          hint="Sign in to save your week, your taste profile, and your basket across devices."
          action={
            <Link to="/sign-in">
              <Button size="pill">Sign in to save</Button>
            </Link>
          }
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <ScreenHeader title="Profile" subtitle={session.user.email} />

      <div className="space-y-6 px-4 pt-2">
        <List>
          <ListRow
            leading={<Store aria-hidden />}
            title="Preferred store"
            value="Albert Heijn"
            chevron
            onClick={() => {}}
          />
          <ListRow
            leading={<Bell aria-hidden />}
            title="Notifications"
            value="On"
            chevron
            onClick={() => {}}
          />
          <ListRow
            leading={<CircleHelp aria-hidden />}
            title="How Souso works"
            chevron
            onClick={() => setHelpOpen(true)}
          />
        </List>

        {isAdmin && (
          <List>
            <ListRow
              leading={<Shield aria-hidden />}
              title="Admin console"
              chevron
              onClick={() => {
                window.location.href = '/admin/users'
              }}
            />
          </List>
        )}

        <List>
          <ListRow
            leading={<RefreshCw aria-hidden />}
            title="Redo onboarding"
            chevron
            onClick={() => {
              window.location.href = '/onboarding'
            }}
          />
          <ListRow
            leading={<LogOut aria-hidden />}
            title="Sign out"
            className="text-destructive [&_svg]:text-destructive"
            onClick={signOut}
          />
        </List>
      </div>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title="How Souso works">
        <div className="text-muted-foreground space-y-4 pb-4 text-[0.95rem] leading-relaxed">
          <p>
            Souso learns how your household eats from a few swipes, plans a week
            of dinners, and fills a ready-to-order basket at Albert Heijn or
            Jumbo. You just check out.
          </p>
          <p>
            Swap any meal with one tap, tell it what changed ("we're out
            Wednesday"), and it replans in seconds. It fits you better every
            week.
          </p>
          <Button size="pill" onClick={() => setHelpOpen(false)}>
            Got it
          </Button>
        </div>
      </Sheet>
    </AppShell>
  )
}
