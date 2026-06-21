import { createFileRoute } from '@tanstack/react-router'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import {
  Users,
  Salad,
  Ban,
  Store,
  Bell,
  Lock,
  ChevronRight,
  Sun,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ScreenHeader } from '#/components/ui/app-shell'
import { DesignShell } from '#/components/design/design-shell'
import { StickyNote } from '#/components/ui/sticky-note'

/**
 * DESIGN PREVIEW (throwaway) — /design/settings. Souso settings: a profile
 * header, then airy hairline rows grouped by section, each with an olive icon
 * tile + value + chevron. Delete before shipping.
 */

interface Row {
  icon: LucideIcon
  label: string
  value?: string
}

const GROUPS: Array<{ title: string; rows: Array<Row> }> = [
  {
    title: 'Your preferences',
    rows: [
      { icon: Users, label: 'Household', value: '2 adults' },
      { icon: Salad, label: 'Diet', value: 'Vegetarian' },
      { icon: Ban, label: 'Dislikes', value: '3 items' },
      { icon: Store, label: 'Supermarket', value: 'Albert Heijn' },
    ],
  },
  {
    title: 'App',
    rows: [
      { icon: Bell, label: 'Notifications' },
      { icon: Lock, label: 'Privacy' },
    ],
  },
]

export const Route = createFileRoute('/design/settings')({
  beforeLoad: requireAdminBeforeLoad,
  component: DesignSettings,
})

function DesignSettings() {
  return (
    <DesignShell>
      <ScreenHeader title="Settings" />

      <div className="px-5">
        {/* Profile */}
        <div className="flex items-center gap-3.5 pb-2">
          <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full border-4 border-white shadow-md">
            <Users className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[1.1rem] font-bold">Teije</p>
            <p className="text-muted-foreground text-xs">Souso since April</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#f1ce8e] bg-[#fbe6c2] px-2.5 py-1 text-[0.7rem] font-extrabold text-[#7a4d10]">
            <Sun className="h-3.5 w-3.5" /> Pro
          </span>
        </div>

        <div className="flex justify-end pt-1 pr-1">
          <StickyNote tilt={-4}>set once, done ✶</StickyNote>
        </div>

        {GROUPS.map((group) => (
          <section key={group.title} className="mt-6">
            <h2 className="text-muted-foreground mb-1 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
              {group.title}
            </h2>
            <div>
              {group.rows.map((row) => {
                const Icon = row.icon
                return (
                  <button
                    key={row.label}
                    type="button"
                    className="border-hairline flex w-full items-center gap-3.5 border-b py-3.5 text-left last:border-b-0"
                  >
                    <span className="bg-secondary text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="h-[1.15rem] w-[1.15rem]" />
                    </span>
                    <span className="flex-1 text-[0.95rem] font-semibold">
                      {row.label}
                    </span>
                    {row.value && (
                      <span className="text-muted-foreground text-sm">
                        {row.value}
                      </span>
                    )}
                    <ChevronRight className="text-muted-foreground/50 h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        <div aria-hidden className="h-8" />
      </div>
    </DesignShell>
  )
}
