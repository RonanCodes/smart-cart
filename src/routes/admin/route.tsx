import type { ReactNode } from 'react'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { Users, FlaskConical, ThumbsUp, Network, Mail } from 'lucide-react'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import { cn } from '#/lib/utils'

/**
 * /admin is a layout route. requireAdminBeforeLoad gates every child, the tab
 * bar is a set of <Link>s (active state from the matched child route via the
 * route-aware `activeProps`), and the matched child renders in the <Outlet/>.
 * Each child owns ONLY its own loader, so opening one tab does not run the
 * other tabs' server fns (e.g. Waitlist no longer runs getBenchmarkMeta).
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: requireAdminBeforeLoad,
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">Admin</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Synthetic users, the data points behind their tastes, and the
        recommender benchmark.
      </p>

      {/* Tabs (each is a real route so refresh + deep-link stay on the tab) */}
      <div role="tablist" className="border-border mb-6 flex gap-1 border-b">
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
          to="/admin/feedback"
          icon={<ThumbsUp className="h-4 w-4" />}
          label="Real feedback"
        />
        <TabLink
          to="/admin/waitlist"
          icon={<Mail className="h-4 w-4" />}
          label="Waitlist"
        />
      </div>

      <Outlet />
    </main>
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
      className="text-muted-foreground hover:text-foreground -mb-px flex items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium transition"
      activeProps={{
        'aria-selected': true,
        className: cn(
          '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
          'border-primary text-foreground',
        ),
      }}
    >
      {icon}
      {label}
    </Link>
  )
}
