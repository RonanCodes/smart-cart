import { useRef, useState } from 'react'
import {
  createFileRoute,
  redirect,
  useNavigate,
  Link,
} from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import {
  loadWeek,
  loadWeekBootstrap,
  resolveLatestPlanId,
} from '#/lib/week-server'
import { weekPlanUrl } from '#/lib/week-url'
import type { WeekView, DayAlternative } from '#/lib/week-server'
import { replanWeek } from '#/lib/replan-server'
import { applyStreamedWeek, streamReplan } from '#/lib/agent/replan-client'
import { getSimilarRecipes } from '#/lib/similar-server'
import { applySimilarSwapToPlan } from '#/lib/swap-server'
import { clearDayInPlan } from '#/lib/week-clear-server'
import { addMealAlternatives } from '#/lib/add-meal-server'
import type { SimilarSort } from '#/lib/vectors/similar'
import type { SimilarNeighbour } from '#/components/week/SimilarSwap'
import { generatePlan } from '#/lib/planner-server'
import { addWeekToShoppingList } from '#/lib/shopping-list-server'
import { addToListCta } from '#/lib/shopping'
import { submitMealFeedback } from '#/lib/meal-feedback-server'
import type { MealFeedbackState } from '#/lib/meal-feedback-server'
import type { MealRating } from '#/lib/meal-feedback'
import { Button } from '#/components/ui/button'
import { DayCard } from '#/components/week/DayCard'
import { ChatReplan } from '#/components/week/ChatReplan'
import { VoiceButton } from '#/components/week/VoiceButton'
import { EditDaySheet } from '#/components/week/EditDaySheet'
import { RatingReminders } from '#/components/week/RatingReminders'
import { WeekSkeleton } from '#/components/week/WeekSkeleton'
import { ReplanBanner } from '#/components/week/ReplanBanner'
import type { PlanDayChange } from '#/lib/replan/diff'

interface WeekSearch {
  plan?: string
}

export const Route = createFileRoute('/_authed/week')({
  validateSearch: (search: Record<string, unknown>): WeekSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
  }),
  // Auth + onboarding now run ONCE in the shared `_authed` layout's beforeLoad
  // (#251); this route reads `{ user, hasHousehold }` off context and no longer
  // re-fires the two guard server fns.
  // Reuse the loader result on back-nav within 30s instead of re-running it on
  // every navigation (#251). TanStack Router's default route staleTime is 0, so
  // returning to /week from /shopping always re-ran the loader (a fresh fan-out);
  // 30s makes Back instant with no refetch while a genuine cold load still runs.
  staleTime: 30_000,
  loaderDeps: ({ search }) => ({ plan: search.plan }),
  loader: async ({
    deps,
  }): Promise<{
    week: WeekView
    feedback: Array<MealFeedbackState>
    missingFromList: number
  }> => {
    // No plan id means "generate one and land on it". A fresh plan keeps the
    // entry point forgiving: /week always shows a week.
    if (!deps.plan) {
      const { planId } = await generatePlan()
      throw redirect({ to: '/week', search: { plan: planId } })
    }
    // ONE round-trip (#251): loadWeekBootstrap composes loadWeek +
    // listMealFeedback + countMissingFromWeek server-side, replacing the old
    // 3-call client Promise.all. Same shape, same data.
    return loadWeekBootstrap({ data: { planId: deps.plan } })
  },
  // Skeleton while the loader resolves (#226). The loader still runs on the
  // server and hydrates first paint (SSR untouched); this only shows on
  // client-side navigations and slow loads, holding the page's shape so the
  // jump to real content is seamless.
  pendingComponent: WeekSkeleton,
  component: WeekPage,
})

function WeekPage() {
  const {
    week: initial,
    feedback: initialFeedback,
    missingFromList,
  } = Route.useLoaderData()
  const navigate = useNavigate()
  const [week, setWeek] = useState<WeekView>(initial)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const [voiceLive, setVoiceLive] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** The per-day diff behind the replan message, for the "Show changes" disclosure. */
  const [changes, setChanges] = useState<Array<PlanDayChange>>([])
  /** The agent's narration as it streams in during a chat replan. */
  const [streamingText, setStreamingText] = useState('')
  /** The day whose edit sheet is open (tap-a-day -> ~5 alternatives). */
  const [editDay, setEditDay] = useState<string | null>(null)
  /**
   * Whether the open sheet is in "add a meal" mode (#175): the day was eating-out
   * / empty, so its alternatives are fetched on demand into `addAlternatives`
   * instead of read from the day (an 'out' day ships none). null while loading.
   */
  const [adding, setAdding] = useState(false)
  const [addAlternatives, setAddAlternatives] =
    useState<Array<DayAlternative> | null>(null)
  /** Busy state for the "Add to shopping list" CTA. */
  const [addingToList, setAddingToList] = useState(false)
  /** Saved post-meal ratings, keyed by recipe id (#126). */
  const [feedback, setFeedback] = useState<Map<string, MealFeedbackState>>(
    () => new Map(initialFeedback.map((f) => [f.recipeId, f])),
  )
  /** The recipe id whose rating write is in flight, if any. */
  const [ratingBusy, setRatingBusy] = useState<string | null>(null)
  /** Days whose dinner a voice replan just changed, glowing for ~3s (#17). */
  const [glowDays, setGlowDays] = useState<ReadonlySet<string>>(() => new Set())
  /** Latest week, read inside the voice-sync callback without stale closure. */
  const weekRef = useRef<WeekView>(week)
  weekRef.current = week

  /**
   * After an in-app voice action, pull the household's newest plan. A voice
   * replan writes a new plan revision server-to-server, so the page can't learn
   * its id any other way. If it's new, adopt it and glow the days that changed
   * (the "AI is doing its magic" cue). Idempotent + cheap: a no-op when nothing
   * changed, so it's safe to fire on every voice message + on call-end.
   */
  async function syncFromVoice() {
    try {
      const prev = weekRef.current
      const { planId } = await resolveLatestPlanId({
        data: { planId: prev.planId },
      })
      if (!planId || planId === prev.planId) return
      const next = await loadWeek({ data: { planId } })
      const changed = next.days
        .filter((d) => {
          const before = prev.days.find((p) => p.day === d.day)
          return before && before.recipeRef !== d.recipeRef
        })
        .map((d) => d.day)
      adopt(next.planId, next)
      if (changed.length > 0) {
        setGlowDays(new Set(changed))
        window.setTimeout(() => setGlowDays(new Set()), 3200)
      }
    } catch {
      // Best-effort live sync; the chat path + a manual reload still work.
    }
  }

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
    setChanges([])
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

  const locked = busyDay !== null || replanning || voiceLive
  const editing = editDay
    ? (week.days.find((d) => d.day === editDay) ?? null)
    : null

  /**
   * Move to a new plan revision: update local state and reflect it in the URL.
   *
   * The week data updates in place via `setWeek` (optimistic, no refetch), so the
   * URL only needs the `plan` search param rewritten for shareability and the back
   * button. We do this with a SHALLOW `history.replaceState` rather than a router
   * `navigate` (#236): a router navigation to a new `plan` value re-runs the route
   * loader, which fires the route's full-page WeekSkeleton pendingComponent (added
   * in #226) and jumps scroll to the top, so every swap/similar/alternative pick
   * flashed the whole page even though the new week was already in hand. A
   * `replaceState` updates the address bar without touching the loader, the
   * pendingComponent, or scroll, so only the affected day's card changes in place
   * (preserving the #145 keep-scroll intent). A genuine cold /week load still runs
   * the loader and shows the skeleton.
   */
  function adopt(planId: string, next: WeekView) {
    setWeek(next)
    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', weekPlanUrl(planId))
    }
  }

  async function swap(day: string) {
    if (locked) return
    setBusyDay(day)
    setMessage(null)
    setChanges([])
    try {
      const res = await replanWeek({
        data: { planId: week.planId, action: 'swap', days: [day] },
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
    setChanges([])
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
    setChanges([])
    try {
      const res = await applySimilarSwapToPlan({
        data: { planId: week.planId, day, recipeId },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
      closeSheet()
    } catch {
      setMessage(
        adding
          ? 'Could not add a meal to that day, try again.'
          : 'Could not swap that day, try again.',
      )
    } finally {
      setBusyDay(null)
    }
  }

  /** Reset the edit/add sheet to closed and clear any fetched add alternatives. */
  function closeSheet() {
    setEditDay(null)
    setAdding(false)
    setAddAlternatives(null)
  }

  /**
   * Remove / skip a day's dinner: the household is not cooking that night (#255).
   * Clears the day server-side (a new plan revision, the old week kept), reloads
   * the week so the card flips to the empty "No dinner, Add one" state, and closes
   * the sheet. The skipped day drops out of the shopping list + the cart because
   * every derivation ignores a day with no recipe, so nothing else needs wiring.
   */
  async function removeDay(day: string) {
    if (locked) return
    setBusyDay(day)
    setMessage(null)
    setChanges([])
    try {
      const res = await clearDayInPlan({
        data: { planId: week.planId, day },
      })
      const next = await loadWeek({ data: { planId: res.planId } })
      adopt(res.planId, next)
      closeSheet()
    } catch {
      setMessage('Could not remove that dinner, try again.')
    } finally {
      setBusyDay(null)
    }
  }

  /**
   * Open the picker in "add a meal" mode for an eating-out / empty day (#175). The
   * day ships no alternatives (topNForDay returns none for an 'out' day), so fetch
   * a fresh household-ranked set on demand, then render it in the same sheet the
   * edit flow uses. Picking persists through the same revision write path
   * (pickAlternative -> applySimilarSwapToPlan), so the day becomes a normal
   * planned day afterwards.
   */
  async function startAdd(day: string) {
    if (locked) return
    setAdding(true)
    setAddAlternatives(null)
    setEditDay(day)
    setMessage(null)
    setChanges([])
    try {
      const res = await addMealAlternatives({
        data: { planId: week.planId, day },
      })
      setAddAlternatives(res.alternatives)
    } catch {
      setAddAlternatives([])
      setMessage('Could not load dinners to add, try again.')
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
    setChanges([])
    try {
      await addWeekToShoppingList({ data: { planId: week.planId } })
      // Await the navigation so the Shopping loader re-runs (and re-reads the
      // rows we just persisted) before we drop the busy state. Without the
      // await the button could re-enable on a half-finished transition; with
      // it the user reliably lands on the saved, editable list.
      await navigate({ to: '/shopping', search: { plan: week.planId } })
    } catch {
      setMessage('Could not add to your shopping list, try again.')
    } finally {
      setAddingToList(false)
    }
  }

  /**
   * Free-text replan through the streaming agent (`POST /api/replan`). The
   * narration streams into the chat box, the grid reflows live as tools fire
   * (optimistic, via `applyStreamedWeek`), and on `done` we reconcile with the
   * authoritative enriched week (`loadWeek`) so images/alternatives are exact.
   * Structured one-tap actions (swap, similar, alternatives) keep using the
   * model-free `replanWeek` / swap-server paths so they work with no API key.
   */
  async function replan(instruction: string) {
    if (locked) return
    const startPlanId = week.planId
    setReplanning(true)
    setMessage(null)
    setChanges([])
    setStreamingText('')
    let finalPlanId = startPlanId
    let changed = false
    let finalMessage: string | null = null
    let finalChanges: Array<PlanDayChange> = []
    try {
      for await (const ev of streamReplan(startPlanId, instruction)) {
        if (ev.type === 'text') {
          setStreamingText((t) => t + ev.delta)
        } else if (ev.type === 'week') {
          setWeek((w) => applyStreamedWeek(w, ev.week))
        } else if (ev.type === 'done') {
          finalMessage = ev.message
          finalPlanId = ev.planId
          changed = ev.changed
          finalChanges = ev.changes
          if (ev.planId !== startPlanId) {
            setWeek((w) => ({ ...w, planId: ev.planId }))
          }
          setReplanning(false)
          setStreamingText('')
        } else {
          finalMessage = ev.message
          setReplanning(false)
          setStreamingText('')
        }
      }
      if (changed) {
        const next = await loadWeek({ data: { planId: finalPlanId } })
        adopt(next.planId, next)
      }
      setMessage(finalMessage)
      setChanges(finalChanges)
    } catch {
      setMessage('Could not adjust the week, try again.')
      setChanges([])
    } finally {
      setReplanning(false)
      setStreamingText('')
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
        <ChatReplan
          busy={replanning}
          onSubmit={replan}
          streamingText={streamingText}
        />
        <VoiceButton
          planId={week.planId}
          disabled={replanning}
          onLiveChange={setVoiceLive}
          onActed={() => void syncFromVoice()}
        />

        <RatingReminders />

        {message && <ReplanBanner message={message} changes={changes} />}

        <div className="grid grid-cols-1 gap-4">
          {week.days.map((d) => (
            <DayCard
              key={d.day}
              day={d}
              busy={busyDay === d.day}
              locked={locked}
              glowing={glowDays.has(d.day)}
              onEdit={() => setEditDay(d.day)}
              onAdd={() => void startAdd(d.day)}
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
          {(() => {
            const cta = addToListCta(missingFromList)
            return (
              <Button
                size="pill"
                disabled={addingToList || locked || cta.disabled}
                onClick={() => void addToShoppingList()}
              >
                <ShoppingBag className="h-5 w-5" aria-hidden />
                {addingToList ? 'Adding...' : cta.label}
              </Button>
            )
          })()}
        </div>
      </div>

      <EditDaySheet
        day={editing}
        open={editDay !== null}
        onOpenChange={(open) => {
          if (!open) closeSheet()
        }}
        picking={busyDay !== null}
        adding={adding}
        addAlternatives={addAlternatives}
        onPick={(recipeId) => {
          if (editDay) void pickAlternative(editDay, recipeId)
        }}
        onRemove={editDay ? () => void removeDay(editDay) : undefined}
      />
    </AppShell>
  )
}
