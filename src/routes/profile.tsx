import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { List, ListRow } from '#/components/ui/list'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { NotificationsSheet } from '#/components/profile/notifications-sheet'
import { PlanReminderSection } from '#/components/profile/plan-reminder-section'
import { StoreSheet } from '#/components/profile/store-sheet'
import { storeLabel, loadProfileBootstrap } from '#/lib/store-pref-server'
import type { StoreSlug, ProfileBootstrap } from '#/lib/store-pref-server'
import { getHouseholdSummary } from '#/lib/onboarding-server'
import type { HouseholdSummary } from '#/lib/onboarding-server'
import { ProfileSkeleton } from '#/components/profile/ProfileSkeleton'

/** The profile route's data: the settings bootstrap plus the taste summary (#268). */
interface ProfileData extends ProfileBootstrap {
  summary: HouseholdSummary | null
}

/**
 * Compose the settings bootstrap (admin + store) with the taste summary in ONE
 * loader (#268). The taste profile moved here from the retired /app pre-plan
 * home; the data source (getHouseholdSummary) is unchanged, only the surface.
 */
async function loadProfileData(): Promise<ProfileData> {
  const [bootstrap, summary] = await Promise.all([
    loadProfileBootstrap(),
    getHouseholdSummary(),
  ])
  return { ...bootstrap, summary }
}

export const Route = createFileRoute('/profile')({
  // Server-decide admin status so the 'Admin console' row only renders for true
  // admins, read the current preferred store so its row shows the real value,
  // and read the taste summary for the 'Your taste' section (#268). ONE
  // round-trip (#251 + #268): loadProfileData composes isAdmin + getStore +
  // getHouseholdSummary server-side, replacing separate calls.
  loader: (): Promise<ProfileData> => loadProfileData(),
  // Reuse the loader result on back-nav within 30s (#251). The useQuery below
  // already keeps the tab instant once mounted; route staleTime stops the loader
  // itself re-firing on a Back into /profile.
  staleTime: 30_000,
  // Skeleton while the loader resolves (#229). The loader still runs on the
  // server and hydrates first paint (SSR untouched); the skeleton only shows on
  // client-side navigations and slow loads, holding the settings layout.
  pendingComponent: ProfileSkeleton,
  component: Profile,
})

/**
 * Profile tab — account + settings. Signed-out visitors get a sign-in CTA;
 * signed-in users see their email and an iOS grouped settings list. Doubles as
 * the in-app showcase of the List + Sheet shell primitives.
 */
function Profile() {
  const { data: session } = authClient.useSession()
  const loaderData = Route.useLoaderData()
  // Cache the admin flag + preferred store under the shared QueryClient (#229)
  // so flicking back to this tab is instant with no refetch. The loader's
  // server-rendered result seeds the cache as initialData, so first paint stays
  // SSR; the query only refetches in the background once it goes stale (30s).
  const { data } = useQuery({
    queryKey: ['profile'],
    queryFn: () => loadProfileData(),
    initialData: loaderData,
  })
  const { isAdmin, store: initialStore, summary } = data
  const [helpOpen, setHelpOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [storeOpen, setStoreOpen] = useState(false)
  const [store, setStore] = useState<StoreSlug>(initialStore)

  async function signOut() {
    // Best-effort client sign-out, then ALWAYS hard-navigate to the server-side
    // /sign-out route, which clears the session cookie server-side and redirects
    // to '/'. The finally guarantees the nav fires even if the client call hangs
    // or throws on mobile. Local dev open-access keeps you signed in, so this
    // only takes visible effect in prod.
    try {
      await authClient.signOut()
    } finally {
      window.location.href = '/sign-out'
    }
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
            value={storeLabel(store)}
            chevron
            onClick={() => setStoreOpen(true)}
          />
          <ListRow
            leading={<Bell aria-hidden />}
            title="Notifications"
            chevron
            onClick={() => setNotificationsOpen(true)}
          />
          <ListRow
            leading={<CircleHelp aria-hidden />}
            title="How Souso works"
            chevron
            onClick={() => setHelpOpen(true)}
          />
        </List>

        {/* Weekly planning reminder (Part B): pick a day + time to be nudged. */}
        <PlanReminderSection />

        {/* Your taste (#268): moved here from the retired /app pre-plan home. */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Your taste</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Built from what you told us in onboarding. It sharpens every week
              as you cook and rate.
            </p>
          </div>

          {summary && summary.badges.length > 0 && (
            <div className="flex flex-wrap gap-2">
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

          <div className="flex flex-wrap gap-2">
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
          </div>
        </section>

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

      <NotificationsSheet
        open={notificationsOpen}
        onOpenChange={setNotificationsOpen}
      />

      <StoreSheet
        open={storeOpen}
        onOpenChange={setStoreOpen}
        current={store}
        onChange={setStore}
      />
    </AppShell>
  )
}
