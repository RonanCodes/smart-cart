import type { ReactNode } from 'react'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  Users,
  FlaskConical,
  ThumbsUp,
  Network,
  Mail,
  Sparkles,
  CreditCard,
  BookOpen,
  Rocket,
  ChevronLeft,
  Palette,
  Beaker,
} from 'lucide-react'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import { ScreenHeader } from '#/components/ui/app-shell'
import { SafeArea } from '#/components/ui/safe-area'
import { TabBar } from '#/components/ui/tab-bar'
import { cn } from '#/lib/utils'

/**
 * /admin is a layout route. requireAdminBeforeLoad gates every child, the tab
 * bar is a set of <Link>s (active state from the matched child route via the
 * route-aware `activeProps`), and the matched child renders in the <Outlet/>.
 * Each child owns ONLY its own loader, so opening one tab does not run the
 * other tabs' server fns (e.g. Waitlist no longer runs getBenchmarkMeta).
 *
 * Layout: admin is data-heavy (master-detail lists, comparison tables, a
 * benchmark console), so unlike the consumer screens it does NOT sit in the
 * 480px phone device-frame (that squashed the Users detail panel to a useless
 * sliver). Instead it renders its own shell: full viewport width, content
 * centred in a wide `max-w-6xl` container so master-detail panels sit
 * side-by-side and tables breathe on desktop, collapsing to a clean
 * single-column at <= 1024px (every panel's own `lg:` grid handles the
 * stacking). The bottom TabBar still mounts as the always-present way back
 * into the user app, and the header keeps the explicit "Back to app"
 * affordance. The admin sub-nav is a segmented pill row (a rounded track with
 * the active tab raised as a card) that scrolls horizontally so all six tabs
 * reach on a narrow screen without wrapping.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: requireAdminBeforeLoad,
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <SafeArea
      edges={['top', 'left', 'right']}
      className="bg-background ios-scroll flex min-h-[100dvh] flex-col"
    >
      <main
        className="mx-auto w-full max-w-6xl flex-1"
        style={{ paddingBottom: 'calc(var(--tab-bar-space) + 1rem)' }}
      >
        <ScreenHeader
          title="Admin"
          subtitle="Synthetic users, the data behind their tastes, and the recommender benchmark."
          action={
            <Link
              to="/week"
              className="text-muted-foreground hover:text-foreground -mr-1 flex items-center gap-0.5 rounded-full px-2 py-1 text-sm font-medium transition active:scale-95"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Back to app
            </Link>
          }
        />

        {/* Sub-nav: a segmented pill row, each tab a real route so refresh +
            deep-link stay on the tab. The track is a rounded inset bar; the
            active tab reads as a raised card inside it. Horizontally scrollable
            on narrow widths (no wrap) so all six pills are reachable at 390px,
            and the whole row fits comfortably on wide desktop. */}
        <div className="mb-5 px-4 sm:px-6">
          <nav
            role="tablist"
            aria-label="Admin sections"
            className="bg-secondary ios-scroll flex gap-1 overflow-x-auto rounded-2xl p-1"
          >
            <TabLink
              to="/admin/users"
              icon={<Users className="h-4 w-4" />}
              label="Users & data points"
            />
            <TabLink
              to="/admin/why"
              icon={<Network className="h-4 w-4" />}
              label="Why these recipes"
            />
            <TabLink
              to="/admin/benchmark"
              icon={<FlaskConical className="h-4 w-4" />}
              label="Benchmark"
            />
            <TabLink
              to="/admin/matching"
              icon={<Sparkles className="h-4 w-4" />}
              label="Matching"
            />
            <TabLink
              to="/admin/feedback"
              icon={<ThumbsUp className="h-4 w-4" />}
              label="Real feedback"
            />
            <TabLink
              to="/admin/waitlist"
              icon={<Mail className="h-4 w-4" />}
              label="Waitlist"
            />
            <TabLink
              to="/admin/payments"
              icon={<CreditCard className="h-4 w-4" />}
              label="Payments"
            />
            <TabLink
              to="/admin/recipes"
              icon={<BookOpen className="h-4 w-4" />}
              label="Recipes"
            />
            <TabLink
              to="/admin/launch"
              icon={<Rocket className="h-4 w-4" />}
              label="Launch"
            />
            <TabLink
              to="/admin/data-mode"
              icon={<Beaker className="h-4 w-4" />}
              label="Demo data"
            />
            {/* Souso design prototype (PR #320). Admin-gated so the throwaway
                /design/* preview is reachable for demos without shipping it as
                a public route. */}
            <TabLink
              to="/design/onboarding"
              icon={<Palette className="h-4 w-4" />}
              label="Design preview"
            />
          </nav>
        </div>

        <div className="px-4 sm:px-6">
          <Outlet />
        </div>
      </main>
      <TabBar />
    </SafeArea>
  )
}

function TabLink({
  to,
  icon,
  label,
}: {
  to: string
  icon: ReactNode
  label: string
}) {
  // Shared shape for both states: a comfortable 44px-tall pill (h-11) that never
  // wraps and never shrinks below its content, so the row scrolls horizontally
  // instead of squashing. Only the colour/elevation differs between states.
  const base =
    'flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium whitespace-nowrap transition'
  return (
    <Link
      to={to}
      role="tab"
      className={cn(
        base,
        'text-muted-foreground hover:text-foreground hover:bg-card/60',
      )}
      activeProps={{
        'aria-selected': true,
        className: cn(base, 'bg-card text-foreground shadow-sm'),
      }}
    >
      {icon}
      {label}
    </Link>
  )
}
