import { useState } from 'react'
import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import {
  User,
  LogOut,
  RefreshCw,
  Eraser,
  Store,
  Bell,
  CircleHelp,
  Shield,
  Heart,
  CalendarOff,
  Languages,
  Users,
  Ban,
  ChevronRight,
  Sun,
} from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { StickyNote } from '#/components/ui/sticky-note'
import { NotificationsSheet } from '#/components/profile/notifications-sheet'
import { PlanReminderSection } from '#/components/profile/plan-reminder-section'
import { StoreSheet } from '#/components/profile/store-sheet'
import { LanguageSheet } from '#/components/profile/language-sheet'
import { PreferencesSheet } from '#/components/profile/preferences-sheet'
import { SkipDaysSheet } from '#/components/profile/skip-days-sheet'
import { storeLabel, loadProfileBootstrap } from '#/lib/store-pref-server'
import type { StoreSlug, ProfileBootstrap } from '#/lib/store-pref-server'
import { getLocale, localeLabel } from '#/lib/locale-pref-server'
import type { Locale } from '#/lib/locale-pref-server'
import { getHouseholdSummary, resetWeekAndCart } from '#/lib/onboarding-server'
import type { HouseholdSummary } from '#/lib/onboarding-server'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import {
  getProfileEditor,
  getInferredSkipDays,
} from '#/lib/profile-edit-server'
import type {
  EditableProfile,
  InferredSkipDays,
} from '#/lib/profile-edit-server'
import { DAY_LABELS } from '#/lib/onboarding-rhythm'
import { ProfileSkeleton } from '#/components/profile/ProfileSkeleton'

/** The profile route's data: the settings bootstrap plus the taste summary (#268)
 * and the editable data points + inferred skip-days (#data-points). */
interface ProfileData extends ProfileBootstrap {
  summary: HouseholdSummary | null
  editor: EditableProfile | null
  inferredSkip: InferredSkipDays | null
  /** The household's recipe-display locale for the Language row (#310). */
  locale: Locale
}

/**
 * Compose the settings bootstrap (admin + store) with the taste summary (#268)
 * and the editable data points (#data-points) in ONE loader. The editor + the
 * inferred skip-days feed the "What Souso knows about you" editing surface.
 */
async function loadProfileData(): Promise<ProfileData> {
  const [bootstrap, summary, editor, inferredSkip, locale] = await Promise.all([
    loadProfileBootstrap(),
    getHouseholdSummary(),
    getProfileEditor(),
    getInferredSkipDays(),
    getLocale(),
  ])
  return { ...bootstrap, summary, editor, inferredSkip, locale }
}

export const Route = createFileRoute('/profile')({
  // Gate signed-out visitors server-side (auth-guards canon): redirect to
  // sign-in in beforeLoad rather than rendering a client-side "sign in" empty
  // state. The loader fns are already safe (they return null / throw for
  // signed-out callers), so this is consistency + a clean redirect.
  beforeLoad: requireUserBeforeLoad,
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
 * A single airy hairline row: an olive icon tile + label + optional trailing
 * value + chevron, divided from the next by a hairline. Matches the settings
 * prototype (/design/settings). Tappable when given an onClick.
 */
function HairlineRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-hairline flex w-full items-center gap-3.5 border-b py-3.5 text-left last:border-b-0 active:opacity-70"
    >
      <span className="bg-secondary text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
        <Icon className="h-[1.15rem] w-[1.15rem]" />
      </span>
      <span className="flex-1 text-[0.95rem] font-semibold">{label}</span>
      {value && (
        <span className="text-muted-foreground max-w-[9rem] truncate text-sm">
          {value}
        </span>
      )}
      <ChevronRight className="text-muted-foreground/50 h-4 w-4 shrink-0" />
    </button>
  )
}

/** Section wrapper: a small uppercase caption over a group of hairline rows. */
function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6">
      <h2 className="text-muted-foreground mb-1 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
        {title}
      </h2>
      <div>{children}</div>
    </section>
  )
}

/** "Souso since April" — the month the household was created. */
function sousoSince(createdAtMs: number): string {
  return new Date(createdAtMs).toLocaleDateString('en-US', { month: 'long' })
}

/** "2 adults", "2 adults + 1 child", "2 adults + 3 kids". */
function householdSummaryLabel(adults: number, children: number): string {
  const adultsPart = `${adults} ${adults === 1 ? 'adult' : 'adults'}`
  if (children <= 0) return adultsPart
  const childrenPart = `${children} ${children === 1 ? 'child' : 'kids'}`
  return `${adultsPart} + ${childrenPart}`
}

/**
 * Profile tab — account + settings, styled to the settings prototype: a profile
 * header (avatar + name + "Souso since <month>" + Pro badge), a hand-written
 * sticky note, then airy hairline rows grouped by section. Every value + action
 * is the household's REAL data (store, language, diet, dislikes, skip-days,
 * notifications, sign-out, …). Signed-out visitors get a sign-in CTA.
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
  const router = useRouter()
  const { isAdmin, store: initialStore, summary, locale: initialLocale } = data
  const [helpOpen, setHelpOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [storeOpen, setStoreOpen] = useState(false)
  const [store, setStore] = useState<StoreSlug>(initialStore)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [skipDaysOpen, setSkipDaysOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  // Local mirrors so an edit reflects immediately without a route reload. Seeded
  // from the loader; updated by each sheet's onSaved with the server's result.
  const [editor, setEditor] = useState<EditableProfile | null>(data.editor)
  const [inferredSkip, setInferredSkip] = useState<InferredSkipDays | null>(
    data.inferredSkip,
  )

  /** The skip-days summary string for the row's trailing value. Manual wins;
   * else the inferred set; else a neutral "Auto". */
  const skipDaysValue = (() => {
    const days = inferredSkip?.manual ?? inferredSkip?.inferred ?? []
    if (inferredSkip?.manual != null && days.length === 0) return 'None'
    if (days.length === 0) return 'Auto'
    return days.map((d) => DAY_LABELS[d]).join(', ')
  })()

  // Real values for the "Your preferences" rows. Diet + dislikes read the live
  // editor draft first (so an edit reflects at once), falling back to the
  // loader's summary. Dislikes is a count ("3 items") like the prototype.
  const dietList = editor?.diet ?? summary?.diet ?? []
  const dietValue = dietList.length ? dietList.join(', ') : 'No restrictions'
  const dislikeCount = editor?.dislikes.length ?? summary?.dislikes.length ?? 0
  const dislikesValue =
    dislikeCount === 0
      ? 'None'
      : `${dislikeCount} ${dislikeCount === 1 ? 'item' : 'items'}`
  const householdValue = summary
    ? householdSummaryLabel(summary.adults, summary.children)
    : undefined

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

  async function startFresh() {
    setResetting(true)
    try {
      await resetWeekAndCart()
      // Hard-nav to the week so it regenerates a clean plan + an empty cart.
      window.location.href = '/week'
    } catch {
      setResetting(false)
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

  // The display name: the email's local-part, title-cased, as a friendly handle
  // (we don't store a separate display name yet). Falls back to "You".
  const displayName = (() => {
    const local = session.user.email.split('@')[0]?.trim()
    if (!local) return 'You'
    return local.charAt(0).toUpperCase() + local.slice(1)
  })()

  return (
    <AppShell>
      <ScreenHeader title="Profile" />

      <div className="px-5">
        {/* Profile header: avatar tile + name + "Souso since <month>" + Pro. */}
        <div className="flex items-center gap-3.5 pb-2">
          <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full border-4 border-white shadow-md">
            <User className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[1.1rem] font-bold">{displayName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {summary
                ? `Souso since ${sousoSince(summary.createdAtMs)}`
                : session.user.email}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#f1ce8e] bg-[#fbe6c2] px-2.5 py-1 text-[0.7rem] font-extrabold text-[#7a4d10]">
            <Sun className="h-3.5 w-3.5" /> Pro
          </span>
        </div>

        <div className="flex justify-end pt-1 pr-1">
          <StickyNote tilt={-4}>set once, done ✶</StickyNote>
        </div>

        {/* Your preferences — the real signals Souso plans with (#data-points).
            Tapping a row opens the matching editor sheet. */}
        <SettingsSection title="Your preferences">
          <HairlineRow
            icon={Users}
            label="Household"
            value={householdValue}
            onClick={() => {
              window.location.href = '/onboarding'
            }}
          />
          <HairlineRow
            icon={Heart}
            label="Taste & diet"
            value={dietValue}
            onClick={() => setPreferencesOpen(true)}
          />
          <HairlineRow
            icon={Ban}
            label="Dislikes"
            value={dislikesValue}
            onClick={() => setPreferencesOpen(true)}
          />
          <HairlineRow
            icon={Store}
            label="Supermarket"
            value={storeLabel(store)}
            onClick={() => setStoreOpen(true)}
          />
          <HairlineRow
            icon={CalendarOff}
            label="Days you skip"
            value={skipDaysValue}
            onClick={() => setSkipDaysOpen(true)}
          />
        </SettingsSection>

        {/* The taste summary badges (#268) — kept as the warm, glanceable proof
            of what Souso has learned, beneath the editable rows. */}
        {summary &&
          (summary.lovedTastes.length > 0 ||
            summary.dislikes.length > 0 ||
            summary.badges.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.badges.map((b) => (
                <span
                  key={b.label}
                  className="bg-secondary text-secondary-foreground inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium"
                >
                  {b.label}
                </span>
              ))}
              {summary.lovedTastes.map((t) => (
                <Badge key={t} variant="primary">
                  {t}
                </Badge>
              ))}
              {summary.dislikes.map((t) => (
                <Badge key={t} variant="outline">
                  no {t}
                </Badge>
              ))}
            </div>
          )}

        {/* App — language, notifications, and how Souso works. */}
        <SettingsSection title="App">
          <HairlineRow
            icon={Languages}
            label="Language"
            value={localeLabel(locale)}
            onClick={() => setLanguageOpen(true)}
          />
          <HairlineRow
            icon={Bell}
            label="Notifications"
            onClick={() => setNotificationsOpen(true)}
          />
          <HairlineRow
            icon={CircleHelp}
            label="How Souso works"
            onClick={() => setHelpOpen(true)}
          />
        </SettingsSection>

        {/* Weekly planning reminder (Part B): pick a day + time to be nudged. */}
        <div className="mt-6">
          <PlanReminderSection />
        </div>

        {/* Admin console — only for true admins (server-decided). */}
        {isAdmin && (
          <SettingsSection title="Admin">
            <HairlineRow
              icon={Shield}
              label="Admin console"
              onClick={() => {
                window.location.href = '/admin/users'
              }}
            />
          </SettingsSection>
        )}

        {/* Account — redo onboarding + sign out. */}
        <SettingsSection title="Account">
          <HairlineRow
            icon={RefreshCw}
            label="Redo onboarding"
            onClick={() => {
              window.location.href = '/onboarding'
            }}
          />
          <HairlineRow
            icon={Eraser}
            label="Start fresh"
            value="Clear week + cart"
            onClick={() => setResetOpen(true)}
          />
          <button
            type="button"
            onClick={signOut}
            className="border-hairline text-destructive flex w-full items-center gap-3.5 border-b py-3.5 text-left last:border-b-0 active:opacity-70"
          >
            <span className="bg-secondary text-destructive flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
            </span>
            <span className="flex-1 text-[0.95rem] font-semibold">
              Sign out
            </span>
          </button>
        </SettingsSection>

        <div aria-hidden className="h-8" />
      </div>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title="How Souso works">
        <div className="text-muted-foreground space-y-4 pb-4 text-[0.95rem] leading-relaxed">
          <p>
            Souso learns how your household eats from a few swipes, plans a week
            of dinners, and fills a ready-to-order basket at Albert Heijn. You
            just check out.
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

      <LanguageSheet
        open={languageOpen}
        onOpenChange={setLanguageOpen}
        current={locale}
        onChange={(next) => {
          setLocale(next)
          // Re-run the route loaders so the week cards + recipe detail re-fetch
          // and render in the newly-picked language immediately (#310).
          void router.invalidate()
        }}
      />

      {editor && (
        <PreferencesSheet
          open={preferencesOpen}
          onOpenChange={setPreferencesOpen}
          current={editor}
          onSaved={setEditor}
        />
      )}

      <SkipDaysSheet
        open={skipDaysOpen}
        onOpenChange={setSkipDaysOpen}
        inferred={inferredSkip}
        onSaved={(next) => {
          setEditor(next)
          // Reflect the new manual override in the row's trailing value at once.
          setInferredSkip((prev) =>
            prev ? { ...prev, manual: next.skipDays } : prev,
          )
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Start fresh?"
        description="Clears your weekly plans and empties your cart so you can demo from scratch. Your household + preferences stay. This can't be undone."
        confirmLabel="Clear week + cart"
        busy={resetting}
        onConfirm={() => void startFresh()}
      />
    </AppShell>
  )
}
