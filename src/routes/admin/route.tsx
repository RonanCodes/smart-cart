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
  Send,
  ChevronLeft,
  Palette,
  Beaker,
  SwatchBook,
  Shield,
} from 'lucide-react'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
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
 * affordance. The admin sub-nav is a segmented pill row inside a rounded card
 * track (hairline border + card surface); the active tab reads as a soft
 * primary-tinted pill. The track scrolls horizontally so every tab is reachable
 * on a narrow screen without wrapping.
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
        {/* Admin header: a contained title bar rather than the consumer
            large-title ScreenHeader, since admin is a wide desktop-leaning
            console, not a phone screen. A small olive shield chip carries the
            "this is the admin area" signal; the title + one-line subtitle sit
            beside it, and the "Back to app" affordance lives top-right as an
            on-brand ghost pill. */}
        <header className="px-4 pt-5 pb-2 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                <Shield className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">
                  Admin
                </h1>
                <p className="text-muted-foreground mt-0.5 text-[0.95rem]">
                  Synthetic users, the data behind their tastes, and the
                  recommender benchmark.
                </p>
              </div>
            </div>
            <Link
              to="/week"
              className="text-muted-foreground hover:text-foreground hover:bg-secondary -mr-1 flex shrink-0 items-center gap-0.5 rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Back to app
            </Link>
          </div>
        </header>

        {/* Sub-nav: a segmented pill row, each tab a real route so refresh +
            deep-link stay on the tab. The track is a rounded card (hairline
            border + card surface, matching the design-system card treatment);
            the active tab reads as a raised inset with a soft primary tint.
            Horizontally scrollable on narrow widths (no wrap) so every tab is
            reachable at 390px, and the whole row fits comfortably on wide
            desktop. */}
        <div className="mt-3 mb-5 px-4 sm:px-6">
          <nav
            role="tablist"
            aria-label="Admin sections"
            className="border-border bg-card ios-scroll flex gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-sm"
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
            {/* Benchmark is dev-only (#460): the algorithm-testing console only
                runs on localhost and no longer makes sense after the matching
                rework, so its nav link is hidden on the deployed build (the
                route itself also redirects). import.meta.env.DEV is statically
                replaced, so this whole link is dead-code-eliminated in prod. */}
            {import.meta.env.DEV && (
              <TabLink
                to="/admin/benchmark"
                icon={<FlaskConical className="h-4 w-4" />}
                label="Benchmark"
              />
            )}
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
              to="/admin/email"
              icon={<Send className="h-4 w-4" />}
              label="Email all"
            />
            <TabLink
              to="/admin/data-mode"
              icon={<Beaker className="h-4 w-4" />}
              label="Demo data"
            />
            <TabLink
              to="/admin/design-system"
              icon={<SwatchBook className="h-4 w-4" />}
              label="Design system"
            />
            {/* Souso design prototype. Now a PUBLIC, noindexed index (/designs)
                so TJ can click the screens for review without logging in. */}
            <TabLink
              to="/designs"
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
        'text-muted-foreground hover:text-foreground hover:bg-secondary',
      )}
      activeProps={{
        'aria-selected': true,
        className: cn(base, 'bg-primary/10 text-primary'),
      }}
    >
      {icon}
      {label}
    </Link>
  )
}
