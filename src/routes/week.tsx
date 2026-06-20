import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { hasHousehold } from '#/lib/onboarding-server'
import { loadWeek } from '#/lib/week-server'
import type { WeekView } from '#/lib/week-server'
import { replanWeek } from '#/lib/replan-server'
import { getSimilarRecipes } from '#/lib/similar-server'
import { applySimilarSwapToPlan } from '#/lib/swap-server'
import type { SimilarSort } from '#/lib/vectors/similar'
import type { SimilarNeighbour } from '#/components/week/SimilarSwap'
import { generatePlan } from '#/lib/planner-server'
import { DayCard } from '#/components/week/DayCard'
import { ChatReplan } from '#/components/week/ChatReplan'

interface WeekSearch {
  plan?: string
}

export const Route = createFileRoute('/week')({
  validateSearch: (search: Record<string, unknown>): WeekSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
  }),
  beforeLoad: async () => {
    const ctx = await requireUserBeforeLoad()
    if (!(await hasHousehold())) throw redirect({ to: '/onboarding' })
    return ctx
  },
  loaderDeps: ({ search }) => ({ plan: search.plan }),
  loader: async ({ deps }): Promise<{ week: WeekView }> => {
    // No plan id means "generate one and land on it". A fresh plan keeps the
    // entry point forgiving: /week always shows a week.
    if (!deps.plan) {
      const { planId } = await generatePlan()
      throw redirect({ to: '/week', search: { plan: planId } })
    }
    return { week: await loadWeek({ data: { planId: deps.plan } }) }
  },
  component: WeekPage,
})

function WeekPage() {
  const { week: initial } = Route.useLoaderData()
  const navigate = useNavigate()
  const [week, setWeek] = useState<WeekView>(initial)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const [replanning, setReplanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const locked = busyDay !== null || replanning

  /** Move to a new plan revision: update local state and reflect it in the URL. */
  function adopt(planId: string, next: WeekView) {
    setWeek(next)
    void navigate({ to: '/week', search: { plan: planId }, replace: true })
  }

  async function swap(day: string) {
    if (locked) return
    setBusyDay(day)
    setMessage(null)
    try {
      const res = await replanWeek({
        data: {
          planId: week.planId,
          instruction: `swap ${day}`,
          focusedDay: day,
        },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
      if (!res.changed) setMessage(res.message)
    } catch {
      setMessage('Could not swap that day, try again.')
    } finally {
      setBusyDay(null)
    }
  }

  /**
   * Load the nearest-neighbour swaps for a day's current dinner (#31), re-ranked
   * by the chooser's toggle. Returns [] for a skipped day (no recipe to match).
   */
  async function loadSimilar(
    day: string,
    sort: SimilarSort,
  ): Promise<Array<SimilarNeighbour>> {
    const d = week.days.find((x) => x.day === day)
    if (!d?.recipeRef) return []
    const res = await getSimilarRecipes({
      data: { recipeId: d.recipeRef, sort },
    })
    return res.neighbours
  }

  /**
   * Persist a chosen similar recipe into a day (#31 pick -> #12 write path). Writes
   * a new plan revision and adopts it, exactly like the next-best swap.
   */
  async function pickSimilar(day: string, recipeId: string) {
    if (locked) return
    setBusyDay(day)
    setMessage(null)
    try {
      const res = await applySimilarSwapToPlan({
        data: { planId: week.planId, day, recipeId },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
    } catch {
      setMessage('Could not swap that day, try again.')
      throw new Error('similar swap failed')
    } finally {
      setBusyDay(null)
    }
  }

  async function replan(instruction: string) {
    if (locked) return
    setReplanning(true)
    setMessage(null)
    try {
      const res = await replanWeek({
        data: { planId: week.planId, instruction },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
      setMessage(res.message)
    } catch {
      setMessage('Could not adjust the week, try again.')
    } finally {
      setReplanning(false)
    }
  }

  return (
    <AppShell>
      <ScreenHeader
        title="Your week"
        subtitle="Seven dinners, one per day. Swap any day or tell us what changed."
      />

      <div className="space-y-6 px-5 pt-2">
        <ChatReplan busy={replanning} onSubmit={replan} />

        {message && (
          <div
            role="status"
            className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm"
          >
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {week.days.map((d) => (
            <DayCard
              key={d.day}
              day={d}
              busy={busyDay === d.day}
              locked={locked}
              onSwap={() => swap(d.day)}
              onLoadSimilar={(sort) => loadSimilar(d.day, sort)}
              onPickSimilar={(recipeId) => pickSimilar(d.day, recipeId)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  )
}
