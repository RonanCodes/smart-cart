import type { ReactNode } from 'react'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import {
  Users,
  FlaskConical,
  ThumbsUp,
  Network,
  Mail,
  Sparkles,
  ChevronLeft,
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
 * affordance. The admin sub-nav is a horizontally scrollable row so all five
 * tabs reach on a narrow screen without wrapping.
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

        {/* Sub-nav: each tab is a real route so refresh + deep-link stay on the
            tab. Horizontally scrollable on narrow widths (no wrap) so all tabs
            are reachable at 390px. */}
        <nav
          role="tablist"
          aria-label="Admin sections"
          className="border-border ios-scroll mb-5 flex gap-1 overflow-x-auto border-b px-4 sm:px-6"
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
        </nav>

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
  return (
    <Link
      to={to}
      role="tab"
      className="text-muted-foreground hover:text-foreground -mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap transition"
      activeProps={{
        'aria-selected': true,
        className: cn(
          '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition',
          'border-primary text-foreground',
        ),
      }}
    >
      {icon}
      {label}
    </Link>
  )
}
