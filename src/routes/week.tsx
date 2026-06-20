import { useState } from 'react'
import {
  createFileRoute,
  redirect,
  useNavigate,
  Link,
} from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
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
import { addWeekToShoppingList } from '#/lib/shopping-list-server'
import {
  submitMealFeedback,
  listMealFeedback,
} from '#/lib/meal-feedback-server'
import type { MealFeedbackState } from '#/lib/meal-feedback-server'
import type { MealRating } from '#/lib/meal-feedback'
import { Button } from '#/components/ui/button'
import { DayCard } from '#/components/week/DayCard'
import { ChatReplan } from '#/components/week/ChatReplan'
import { EditDaySheet } from '#/components/week/EditDaySheet'

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
  loader: async ({
    deps,
  }): Promise<{ week: WeekView; feedback: Array<MealFeedbackState> }> => {
    // No plan id means "generate one and land on it". A fresh plan keeps the
    // entry point forgiving: /week always shows a week.
    if (!deps.plan) {
      const { planId } = await generatePlan()
      throw redirect({ to: '/week', search: { plan: planId } })
    }
    const [week, feedback] = await Promise.all([
      loadWeek({ data: { planId: deps.plan } }),
      listMealFeedback({ data: { planId: deps.plan } }),
    ])
    return { week, feedback }
  },
  component: WeekPage,
})

function WeekPage() {
  const { week: initial, feedback: initialFeedback } = Route.useLoaderData()
  const navigate = useNavigate()
  const [week, setWeek] = useState<WeekView>(initial)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const [replanning, setReplanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** The day whose edit sheet is open (tap-a-day -> ~5 alternatives). */
  const [editDay, setEditDay] = useState<string | null>(null)
  /** Busy state for the "Add to shopping list" CTA. */
  const [addingToList, setAddingToList] = useState(false)
  /** Saved post-meal ratings, keyed by recipe id (#126). */
  const [feedback, setFeedback] = useState<Map<string, MealFeedbackState>>(
    () => new Map(initialFeedback.map((f) => [f.recipeId, f])),
  )
  /** The recipe id whose rating write is in flight, if any. */
  const [ratingBusy, setRatingBusy] = useState<string | null>(null)

  /**
   * Submit a post-meal rating for a day's dinner (#126). Writes meal_feedback via
   * the household-scoped server fn (idempotent per recipe+plan), then reflects the
   * stored state locally so the chosen thumbs sticks without a refetch. The
   * recommender folds this row into next week's taste, so a thumbs-down visibly
   * shifts future suggestions.
   */
  async function rate(
    recipeId: string,
    next: { rating: MealRating; note: string | null },
  ) {
    if (!recipeId || ratingBusy) return
    setRatingBusy(recipeId)
    setMessage(null)
    try {
      const res = await submitMealFeedback({
        data: {
          planId: week.planId,
          recipeId,
          rating: next.rating,
          note: next.note,
        },
      })
      setFeedback((prev) => {
        const map = new Map(prev)
        if (res.feedback) map.set(recipeId, res.feedback)
        else map.delete(recipeId)
        return map
      })
    } catch {
      setMessage('Could not save your rating, try again.')
    } finally {
      setRatingBusy(null)
    }
  }

  const locked = busyDay !== null || replanning
  const editing = editDay
    ? (week.days.find((d) => d.day === editDay) ?? null)
    : null

  /**
   * Move to a new plan revision: update local state and reflect it in the URL.
   *
   * The week data updates in place via `setWeek` (optimistic, no refetch), so the
   * navigation here only rewrites the `plan` search param for shareability and the
   * back button. The router runs with `scrollRestoration: true` (see router.tsx),
   * which treats a new `plan` value as a fresh location and would reset scroll to
   * the top after every swap/similar/alternative pick (#145). `resetScroll: false`
   * keeps the user exactly where they were so the day they just edited stays in view.
   */
  function adopt(planId: string, next: WeekView) {
    setWeek(next)
    void navigate({
      to: '/week',
      search: { plan: planId },
      replace: true,
      resetScroll: false,
    })
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

  /**
   * Pick one of the day's ~5 ready alternatives (the tap-a-day edit, #123). Writes
   * the chosen recipe into the day via the same revision write path the similar
   * swap uses (applySimilarSwapToPlan accepts any catalogue recipe), reloads the
   * week (which re-derives fresh alternatives for every day), and closes the sheet.
   */
  async function pickAlternative(day: string, recipeId: string) {
    if (locked) return
    setBusyDay(day)
    setMessage(null)
    try {
      const res = await applySimilarSwapToPlan({
        data: { planId: week.planId, day, recipeId },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
      setEditDay(null)
    } catch {
      setMessage('Could not swap that day, try again.')
    } finally {
      setBusyDay(null)
    }
  }

  /**
   * Add this week's recipes' ingredients (portion-scaled, the same consolidation
   * the Shopping tab shows) to the household's persisted shopping list, then land
   * on the Shopping tab so the user sees the saved, editable list. Idempotent on
   * the server: pressing it again merges rather than duplicating.
   */
  async function addToShoppingList() {
    if (addingToList) return
    setAddingToList(true)
    setMessage(null)
    try {
      await addWeekToShoppingList({ data: { planId: week.planId } })
      void navigate({ to: '/shopping', search: { plan: week.planId } })
    } catch {
      setMessage('Could not add to your shopping list, try again.')
      setAddingToList(false)
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
        action={
          <Link
            to="/shopping"
            search={{ plan: week.planId }}
            className="text-primary inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden />
            Shopping list
          </Link>
        }
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
              onEdit={() => setEditDay(d.day)}
              onSwap={() => swap(d.day)}
              onLoadSimilar={(sort) => loadSimilar(d.day, sort)}
              onPickSimilar={(recipeId) => pickSimilar(d.day, recipeId)}
              rating={feedback.get(d.recipeRef)?.rating ?? null}
              ratingNote={feedback.get(d.recipeRef)?.note ?? null}
              ratingBusy={ratingBusy === d.recipeRef}
              onRate={(next) => rate(d.recipeRef, next)}
            />
          ))}
        </div>

        <div className="pt-2 pb-2">
          <Button
            size="pill"
            disabled={addingToList || locked}
            onClick={() => void addToShoppingList()}
          >
            <ShoppingBag className="h-5 w-5" aria-hidden />
            {addingToList ? 'Adding...' : 'Add to shopping list'}
          </Button>
        </div>
      </div>

      <EditDaySheet
        day={editing}
        open={editDay !== null}
        onOpenChange={(open) => {
          if (!open) setEditDay(null)
        }}
        picking={busyDay !== null}
        onPick={(recipeId) => {
          if (editDay) void pickAlternative(editDay, recipeId)
        }}
      />
    </AppShell>
  )
}
