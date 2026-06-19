import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Users, FlaskConical, ThumbsUp } from 'lucide-react'
import {
  requireAdminBeforeLoad,
  listUsers,
  getBenchmarkMeta,
  listRealFeedbackHouseholds,
} from '#/lib/admin-server'
import { cn } from '#/lib/utils'
import { UsersPanel } from '#/components/admin/UsersPanel'
import { BenchmarkConsole } from '#/components/admin/benchmark/BenchmarkConsole'
import { RealFeedbackPanel } from '#/components/admin/RealFeedbackPanel'

type Tab = 'users' | 'benchmark' | 'feedback'

export const Route = createFileRoute('/admin')({
  beforeLoad: requireAdminBeforeLoad,
  loader: async () => ({
    users: await listUsers(),
    benchmarkMeta: await getBenchmarkMeta(),
    realFeedbackHouseholds: await listRealFeedbackHouseholds(),
  }),
  component: Admin,
})

function Admin() {
  const { users, benchmarkMeta, realFeedbackHouseholds } = Route.useLoaderData()
  const [tab, setTab] = useState<Tab>('users')

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">Admin</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Synthetic users, the data points behind their tastes, and the
        recommender benchmark.
      </p>

      {/* Tabs (desktop admin surface) */}
      <div role="tablist" className="border-border mb-6 flex gap-1 border-b">
        <TabButton
          active={tab === 'users'}
          onClick={() => setTab('users')}
          icon={<Users className="h-4 w-4" />}
          label="Users & data points"
        />
        <TabButton
          active={tab === 'benchmark'}
          onClick={() => setTab('benchmark')}
          icon={<FlaskConical className="h-4 w-4" />}
          label="Benchmark"
        />
        <TabButton
          active={tab === 'feedback'}
          onClick={() => setTab('feedback')}
          icon={<ThumbsUp className="h-4 w-4" />}
          label="Real feedback"
        />
      </div>

      {tab === 'users' && <UsersPanel users={users} />}
      {tab === 'benchmark' && <BenchmarkConsole meta={benchmarkMeta} />}
      {tab === 'feedback' && (
        <RealFeedbackPanel households={realFeedbackHouseholds} />
      )}
    </main>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
        active
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
