import { useCallback, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  redirect,
  useNavigate,
  Link,
} from '@tanstack/react-router'
import {
  ShoppingBasket,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  Sparkles,
} from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import {
  loadWeek,
  loadWeekBootstrap,
  loadWeekForOffset,
  generateWeekForOffset,
  resolveLatestPlanId,
} from '#/lib/week-server'
import { weekLabel, offsetForWeekStart } from '#/lib/week-offset'
import { weekPlanUrl } from '#/lib/week-url'
import type { WeekView, DayAlternative } from '#/lib/week-server'
import { applyStreamedWeek, streamReplan } from '#/lib/agent/replan-client'
import type { ReplanHistoryTurn } from '#/lib/agent/replan-client'
import { mergeWeekPreservingIdentity } from '#/lib/week-merge'
import { detectTargetDays } from '#/lib/replan/target-days'
import { getSimilarRecipes } from '#/lib/similar-server'
import { applySimilarSwapToPlan } from '#/lib/swap-server'
import { clearDayInPlan } from '#/lib/week-clear-server'
import { addMealAlternatives } from '#/lib/add-meal-server'
import type { SimilarSort } from '#/lib/vectors/similar'
import type { SimilarNeighbour } from '#/components/week/SimilarSwap'
import { addWeekToShoppingList } from '#/lib/shopping-list-server'
import { addToListCta } from '#/lib/shopping'
import { submitMealFeedback } from '#/lib/meal-feedback-server'
import type { MealFeedbackState } from '#/lib/meal-feedback-server'
import type { MealRating } from '#/lib/meal-feedback'
import { Button } from '#/components/ui/button'
import { DayCard } from '#/components/week/DayCard'
import { ChatReplan } from '#/components/week/ChatReplan'
import { VoiceButton } from '#/components/week/VoiceButton'
import { RecipeSheet } from '#/components/week/RecipeSheet'
import { SwapSheet } from '#/components/week/SwapSheet'
import { Sheet } from '#/components/ui/sheet'
import { StickyNote } from '#/components/ui/sticky-note'
import { RatingReminders } from '#/components/week/RatingReminders'
import { WeekSkeleton } from '#/components/week/WeekSkeleton'
import { ReplanBanner } from '#/components/week/ReplanBanner'
import type { PlanDayChange } from '#/lib/replan/diff'

interface WeekSearch {
  plan?: string
  /** Week offset for prev/next navigation: 0 = this week, +1 = next, -1 = last. */
  week?: number
}

/**
 * The /week loader payload. Either a loaded week (with its data + the resolved
 * offset for the nav) or an empty state (a past week the household never planned,
 * or a future week not yet generated). `offset` is ALWAYS a real number now
 * (#week-nav bug 2): when reached by a bare `?plan=<id>` deep-link (in-place
 * swaps + legacy links) we derive the offset from the loaded plan's `weekStart`,
 * so the prev/next nav never disappears after a swap rewrites the URL to `?plan=`.
 */
type WeekLoaderData =
  | {
      kind: 'week'
      offset: number
      week: WeekView
      feedback: Array<MealFeedbackState>
      missingFromList: number
    }
  | { kind: 'empty'; offset: number; weekStart: string }

export const Route = createFileRoute('/_authed/week')({
  validateSearch: (search: Record<string, unknown>): WeekSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
    week:
      typeof search.week === 'number'
        ? Math.trunc(search.week)
        : typeof search.week === 'string' && search.week.trim() !== ''
          ? Math.trunc(Number(search.week))
          : undefined,
  }),
  // Auth + onboarding now run ONCE in the shared `_authed` layout's beforeLoad
  // (#251); this route reads `{ user, hasHousehold }` off context and no longer
  // re-fires the two guard server fns.
  // Reuse the loader result on back-nav within 30s instead of re-running it on
  // every navigation (#251). TanStack Router's default route staleTime is 0, so
  // returning to /week from /shopping always re-ran the loader (a fresh fan-out);
  // 30s makes Back instant with no refetch while a genuine cold load still runs.
  staleTime: 30_000,
  loaderDeps: ({ search }) => ({ plan: search.plan, week: search.week }),
  loader: async ({ deps }): Promise<WeekLoaderData> => {
    // Week-offset navigation (Part A) takes precedence: `?week=<offset>` loads
    // (or, for current/future weeks, generates) that week. A past week with no
    // plan returns an empty state we render with a "plan this week" CTA.
    if (deps.week !== undefined && !Number.isNaN(deps.week)) {
      const res = await loadWeekForOffset({ data: { offset: deps.week } })
      if (res.kind === 'empty') {
        return { kind: 'empty', offset: res.offset, weekStart: res.weekStart }
      }
      const { listMealFeedback } = await import('#/lib/meal-feedback-server')
      const { countMissingFromWeek } =
        await import('#/lib/shopping-list-server')
      const [feedback, missing] = await Promise.all([
        listMealFeedback({ data: { planId: res.week.planId } }),
        countMissingFromWeek({ data: { planId: res.week.planId } }),
      ])
      return {
        kind: 'week',
        offset: res.offset,
        week: res.week,
        feedback,
        missingFromList: missing.missing,
      }
    }
    // No plan id and no week offset means "land on this week". Redirect to the
    // canonical `?week=0` entry so navigation + deep-links share one shape.
    if (!deps.plan) {
      throw redirect({ to: '/week', search: { week: 0 } })
    }
    // ONE round-trip (#251): loadWeekBootstrap composes loadWeek +
    // listMealFeedback + countMissingFromWeek server-side. Reached via a bare
    // `?plan=<id>` link (legacy + in-place swaps). We derive the offset from the
    // loaded plan's weekStart so the prev/next nav ALWAYS shows (#week-nav bug
    // 2): an in-place swap/replan rewrites the URL to `?plan=`, and before this
    // the nav vanished because offset was null.
    const bootstrap = await loadWeekBootstrap({ data: { planId: deps.plan } })
    return {
      kind: 'week',
      offset: offsetForWeekStart(bootstrap.week.weekStart),
      ...bootstrap,
    }
  },
  // Skeleton while the loader resolves (#226). The loader still runs on the
  // server and hydrates first paint (SSR untouched); this only shows on
  // client-side navigations and slow loads, holding the page's shape so the
  // jump to real content is seamless.
  pendingComponent: WeekSkeleton,
  component: WeekPage,
})

function WeekPage() {
  const loaderData = Route.useLoaderData()

  // An empty week (a past week never planned, or a future week not yet
  // generated): show an empty state, plus the same prev/next nav so the user can
  // keep browsing.
  if (loaderData.kind === 'empty') {
    return <EmptyWeek offset={loaderData.offset} />
  }

  return (
    <LoadedWeek
      initial={loaderData.week}
      initialFeedback={loaderData.feedback}
      missingFromList={loaderData.missingFromList}
      offset={loaderData.offset}
    />
  )
}

/**
 * Prev/next week navigation (Part A). Mobile-first, no hover-only affordance:
 * two large tap targets flanking the resolved week label. Navigating changes the
 * `?week=<offset>` search param, which re-runs the loader (loading or generating
 * that week). ALWAYS shown now (#week-nav bug 2): even a bare `?plan=` deep-link
 * resolves a real offset from the loaded plan's weekStart, so the nav never
 * disappears after an in-place swap/replan rewrites the URL.
 */
function WeekNav({ offset }: { offset: number }) {
  const navigate = useNavigate()
  const go = (next: number) =>
    void navigate({ to: '/week', search: { week: next } })
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <button
        type="button"
        aria-label="Previous week"
        onClick={() => go(offset - 1)}
        className="text-foreground bg-secondary inline-flex h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <span className="text-sm font-semibold" data-testid="week-label">
        {weekLabel(offset)}
      </span>
      <button
        type="button"
        aria-label="Next week"
        onClick={() => go(offset + 1)}
        className="text-foreground bg-secondary inline-flex h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  )
}

/**
 * An empty week's state (#week-nav). Two shapes by direction:
 *  - FUTURE (offset > 0): the week is not generated yet. Show a "Generate next
 *    week" CTA that explicitly generates it (no more auto-generated clone of
 *    this week, #week-nav bug 1) then lands on it.
 *  - PAST (offset < 0): never back-filled. Keep the existing "go to this week"
 *    behaviour so the user drops back onto a real week.
 * Both show the week label so the user knows which week they are on, plus the
 * same prev/next nav so they can keep browsing.
 */
function EmptyWeek({ offset }: { offset: number }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const isFuture = offset > 0

  // Future: generate the plan for THIS offset, then navigate to it (the loader
  // now finds the freshly-written plan). Past: drop back to this week.
  async function act() {
    if (busy) return
    setBusy(true)
    try {
      if (isFuture) {
        await generateWeekForOffset({ data: { offset } })
        await navigate({ to: '/week', search: { week: offset } })
      } else {
        await navigate({ to: '/week', search: { week: 0 } })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <ScreenHeader title="Your week" />
      <div className="space-y-6 px-5 pt-2">
        <WeekNav offset={offset} />
        <EmptyState
          icon={<CalendarPlus aria-hidden />}
          title={isFuture ? weekLabel(offset) : 'No plan for this week'}
          hint={
            isFuture
              ? `Nothing planned for ${weekLabel(offset).toLowerCase()} yet. Generate it when you're ready.`
              : "You didn't plan this week. Jump back to this week to keep cooking."
          }
          action={
            <Button size="pill" disabled={busy} onClick={() => void act()}>
              {isFuture
                ? busy
                  ? 'Generating...'
                  : 'Generate next week'
                : 'Go to this week'}
            </Button>
          }
        />
      </div>
    </AppShell>
  )
}

function LoadedWeek({
  initial,
  initialFeedback,
  missingFromList,
  offset,
}: {
  initial: WeekView
  initialFeedback: Array<MealFeedbackState>
  missingFromList: number
  offset: number
}) {
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
  /** The day whose recipe sheet is open (tap-a-planned-dish -> ingredients + steps). */
  const [recipeDay, setRecipeDay] = useState<string | null>(null)
  /** The day whose swap chooser pull-up is open (Swap button / "Add a meal"). */
  const [swapDay, setSwapDay] = useState<string | null>(null)
  /**
   * Whether the open swap sheet is in "add a meal" mode (#175): the day was
   * eating-out / empty, so its alternatives are fetched on demand into
   * `addAlternatives` instead of read from the day (an 'out' day ships none). null
   * while loading.
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
  /**
   * Days that Souso is actively working on WHILE a replan is in flight
   * (#replan-ux). Driven by the day name(s) in the chat instruction, or a
   * single-day voice swap. Empty set + `replanning` true means "target not known
   * yet" — the chat card glows instead (see `workingGlow`).
   */
  const [workingDays, setWorkingDays] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  /** Latest week, read inside the voice-sync callback without stale closure. */
  const weekRef = useRef<WeekView>(week)
  weekRef.current = week
  /**
   * Latest `locked` + `ratingBusy`, read inside the STABLE per-day callbacks
   * below without a stale closure (#replan-ux). DayCard is memoised so a card
   * that doesn't re-render holds the callback reference it was first given;
   * reading these guards from refs keeps that held callback correct.
   */
  const lockedRef = useRef(false)
  const ratingBusyRef = useRef<string | null>(null)

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
  const rate = useCallback(
    async (
      recipeId: string,
      next: { rating: MealRating; note: string | null },
    ) => {
      if (!recipeId || ratingBusyRef.current) return
      setRatingBusy(recipeId)
      setMessage(null)
      setChanges([])
      try {
        const res = await submitMealFeedback({
          data: {
            planId: weekRef.current.planId,
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
    },
    [],
  )

  const locked = busyDay !== null || replanning || voiceLive
  lockedRef.current = locked
  ratingBusyRef.current = ratingBusy
  const recipeViewing = recipeDay
    ? (week.days.find((d) => d.day === recipeDay) ?? null)
    : null
  const swapping = swapDay
    ? (week.days.find((d) => d.day === swapDay) ?? null)
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
  // `adopt` and the per-day handlers below are STABLE (`useCallback([])`,
  // reading mutable state from refs) so DayCard's `React.memo` actually holds: a
  // card that doesn't re-render keeps the same callback references and never goes
  // stale (#replan-ux).
  const adopt = useCallback((planId: string, next: WeekView) => {
    // Identity-preserving merge (#replan-ux): keep the SAME object reference for
    // every day whose rendered fields didn't change, so memoised DayCards for
    // unchanged days skip rendering and the grid stays rock-steady. A naive
    // `setWeek(next)` swapped the whole week object, handing all seven cards new
    // props and letting a single-day swap jitter its siblings.
    setWeek((prev) => mergeWeekPreservingIdentity(prev, next))
    if (typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', weekPlanUrl(planId))
    }
  }, [])

  /**
   * Load the nearest-neighbour swaps for a day's current dinner (#31), re-ranked
   * by the chooser's toggle. Returns [] for a skipped day (no recipe to match).
   */
  const loadSimilar = useCallback(
    async (
      day: string,
      sort: SimilarSort,
    ): Promise<Array<SimilarNeighbour>> => {
      const d = weekRef.current.days.find((x) => x.day === day)
      if (!d?.recipeRef) return []
      const res = await getSimilarRecipes({
        data: { recipeId: d.recipeRef, sort },
      })
      return res.neighbours
    },
    [],
  )

  /**
   * Persist a chosen similar recipe into a day (#31 pick -> #12 write path). Writes
   * a new plan revision and adopts it, exactly like the next-best swap.
   */
  const pickSimilar = useCallback(
    async (day: string, recipeId: string) => {
      if (lockedRef.current) return
      setBusyDay(day)
      setMessage(null)
      setChanges([])
      try {
        const res = await applySimilarSwapToPlan({
          data: { planId: weekRef.current.planId, day, recipeId },
        })
        const next = await loadWeek({ data: { planId: res.planId } })
        adopt(res.planId, next)
      } catch {
        setMessage('Could not swap that day, try again.')
        throw new Error('similar swap failed')
      } finally {
        setBusyDay(null)
      }
    },
    [adopt],
  )

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
      closeSwapSheet()
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

  /** Close the swap / add chooser and clear any fetched add alternatives. */
  function closeSwapSheet() {
    setSwapDay(null)
    setAdding(false)
    setAddAlternatives(null)
  }

  /** Open the swap chooser pull-up for a planned day (the Swap button / the
   * "Swap this dinner" action inside the recipe sheet). Closes the recipe sheet
   * so the two pull-ups never stack. Stable for DayCard's memo (#replan-ux). */
  const startSwap = useCallback((day: string) => {
    if (lockedRef.current) return
    setRecipeDay(null)
    setAdding(false)
    setAddAlternatives(null)
    setSwapDay(day)
  }, [])

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
      setRecipeDay(null)
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
  const startAdd = useCallback(async (day: string) => {
    if (lockedRef.current) return
    setRecipeDay(null)
    setAdding(true)
    setAddAlternatives(null)
    setSwapDay(day)
    setMessage(null)
    setChanges([])
    try {
      const res = await addMealAlternatives({
        data: { planId: weekRef.current.planId, day },
      })
      setAddAlternatives(res.alternatives)
    } catch {
      setAddAlternatives([])
      setMessage('Could not load dinners to add, try again.')
    }
  }, [])

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
   * model-free swap-server paths so they work with no API key.
   */
  async function replan(
    instruction: string,
    history: Array<ReplanHistoryTurn>,
  ): Promise<string> {
    if (locked) return ''
    const startPlanId = week.planId
    setReplanning(true)
    setMessage(null)
    setChanges([])
    setStreamingText('')
    // Pre-glow the day(s) the instruction names WHILE Souso works (#replan-ux).
    // If no day is named yet, the chat card glows instead (see `workingGlow`).
    setWorkingDays(new Set(detectTargetDays(instruction)))
    let finalPlanId = startPlanId
    let changed = false
    let finalMessage: string | null = null
    let finalChanges: Array<PlanDayChange> = []
    try {
      for await (const ev of streamReplan(startPlanId, instruction, {
        history,
      })) {
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
        // Play the per-changed-day "magic" glow on exactly the days the diff
        // says moved, so the post-change confirmation matches the real result.
        const changedDays = finalChanges.map((c) => c.day)
        if (changedDays.length > 0) {
          setGlowDays(new Set(changedDays))
          window.setTimeout(() => setGlowDays(new Set()), 3200)
        }
      }
      setMessage(finalMessage)
      setChanges(finalChanges)
      return finalMessage ?? "Done. I've updated your week."
    } catch {
      setMessage('Could not adjust the week, try again.')
      setChanges([])
      return 'Could not adjust the week, try again.'
    } finally {
      setReplanning(false)
      setStreamingText('')
      setWorkingDays(new Set())
    }
  }

  // Stable per-day bound callbacks, keyed by day label (#replan-ux). Built once
  // per day-set (the labels never change order: Monday..Sunday) from the stable
  // handlers above, so each DayCard gets the SAME callback objects across renders
  // and `React.memo` holds. Recipe-dependent actions (rate) resolve the current
  // recipe at call time via `weekRef`, so binding by the stable day label is safe
  // even after a swap changes the day's recipe.
  const dayKeys = week.days.map((d) => d.day).join('|')
  const dayCallbacks = useMemo(() => {
    const map = new Map<
      string,
      {
        onEdit: () => void
        onAdd: () => void
        onSwap: () => void
        onLoadSimilar: (sort: SimilarSort) => Promise<Array<SimilarNeighbour>>
        onPickSimilar: (recipeId: string) => Promise<void>
        onRate: (next: {
          rating: MealRating
          note: string | null
        }) => Promise<void>
      }
    >()
    for (const day of dayKeys.split('|')) {
      if (!day) continue
      map.set(day, {
        onEdit: () => setRecipeDay(day),
        onAdd: () => void startAdd(day),
        onSwap: () => startSwap(day),
        onLoadSimilar: (sort) => loadSimilar(day, sort),
        onPickSimilar: (recipeId) => pickSimilar(day, recipeId),
        onRate: (next) => {
          const recipeId =
            weekRef.current.days.find((x) => x.day === day)?.recipeRef ?? ''
          return rate(recipeId, next)
        },
      })
    }
    return map
    // The stable handlers never change identity, so the map rebuilds only when
    // the day set changes (added/removed/reordered days, essentially never).
  }, [dayKeys, startAdd, startSwap, loadSimilar, pickSimilar, rate])

  // The AI replan + voice live behind one subtle "Ask Souso" button that opens a
  // sheet, keeping the week screen calm and Julienne-quiet by default (#design).
  const [aiOpen, setAiOpen] = useState(false)

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
            <ShoppingBasket className="h-4 w-4" aria-hidden />
            Shopping list
          </Link>
        }
      />

      <div className="space-y-6 px-5 pt-2">
        <WeekNav offset={offset} />
        <div className="-mb-3 flex justify-end pr-1">
          <StickyNote tilt={4}>
            no more &ldquo;what&rsquo;s for dinner?&rdquo;
          </StickyNote>
        </div>
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          className="border-border bg-card text-muted-foreground flex w-full items-center gap-2.5 rounded-full border px-4 py-3 text-sm shadow-sm transition active:scale-[0.99]"
        >
          <Sparkles className="text-primary h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">Ask Souso to tweak your week</span>
          {replanning ? (
            <span className="text-primary text-xs font-semibold">working…</span>
          ) : (
            <span className="text-muted-foreground/70 text-xs">
              eating out? cheaper?
            </span>
          )}
        </button>

        <RatingReminders />

        {message && <ReplanBanner message={message} changes={changes} />}

        <div className="grid grid-cols-1 gap-4">
          {week.days.map((d) => {
            const cbs = dayCallbacks.get(d.day)!
            return (
              <DayCard
                key={d.day}
                day={d}
                busy={busyDay === d.day}
                locked={locked}
                glowing={glowDays.has(d.day)}
                working={workingDays.has(d.day)}
                onEdit={cbs.onEdit}
                onAdd={cbs.onAdd}
                onSwap={cbs.onSwap}
                onLoadSimilar={cbs.onLoadSimilar}
                onPickSimilar={cbs.onPickSimilar}
                rating={feedback.get(d.recipeRef)?.rating ?? null}
                ratingNote={feedback.get(d.recipeRef)?.note ?? null}
                ratingBusy={ratingBusy === d.recipeRef}
                onRate={cbs.onRate}
              />
            )
          })}
        </div>

        {/* Spacer so the last card clears the floating "make basket" button. */}
        <div aria-hidden className="h-16" />
      </div>

      {/* Floating primary action: build the basket. Sits above the tab bar so it
          stays in reach while scrolling the week. */}
      <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
        {(() => {
          const cta = addToListCta(missingFromList)
          return (
            <Button
              size="pill"
              className="shadow-lg"
              disabled={addingToList || locked || cta.disabled}
              onClick={() => void addToShoppingList()}
            >
              <ShoppingBasket className="h-5 w-5" aria-hidden />
              {addingToList ? 'Adding...' : cta.label}
            </Button>
          )
        })()}
      </div>

      <Sheet open={aiOpen} onOpenChange={setAiOpen} title="Ask Souso">
        <div className="flex flex-col gap-4 pb-2">
          <ChatReplan
            busy={replanning}
            onSubmit={replan}
            streamingText={streamingText}
            working={replanning && workingDays.size === 0}
          />
          <VoiceButton
            planId={week.planId}
            disabled={replanning}
            onLiveChange={setVoiceLive}
            onActed={() => void syncFromVoice()}
          />
        </div>
      </Sheet>

      <RecipeSheet
        day={recipeViewing}
        open={recipeDay !== null}
        onOpenChange={(open) => {
          if (!open) setRecipeDay(null)
        }}
        busy={busyDay !== null}
        onSwap={() => {
          if (recipeDay) startSwap(recipeDay)
        }}
        onRemove={recipeDay ? () => void removeDay(recipeDay) : undefined}
      />

      <SwapSheet
        day={swapping}
        open={swapDay !== null}
        onOpenChange={(open) => {
          if (!open) closeSwapSheet()
        }}
        picking={busyDay !== null}
        adding={adding}
        addAlternatives={addAlternatives}
        onPick={(recipeId) => {
          if (swapDay) void pickAlternative(swapDay, recipeId)
        }}
      />
    </AppShell>
  )
}
