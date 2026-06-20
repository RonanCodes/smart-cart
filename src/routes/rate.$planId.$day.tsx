import { useState } from 'react'
import {
  createFileRoute,
  useNavigate,
  useRouter,
  Link,
} from '@tanstack/react-router'
import { X, Clock, Flame, Beef, UtensilsCrossed, CalendarX } from 'lucide-react'
import { SafeArea } from '#/components/ui/safe-area'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { loadRateMeal } from '#/lib/rate-meal-server'
import type { RateMealResult } from '#/lib/rate-meal-server'
import { submitMealFeedback } from '#/lib/meal-feedback-server'
import type { MealRating as Rating } from '#/lib/meal-feedback'
import { MealRating } from '#/components/week/MealRating'

/**
 * Focused rate-this-meal view (#214). The rate-meal push deep-links here
 * (/rate/$planId/$day) so tapping "How was <meal>?" lands on THIS dinner, not the
 * whole week. Rendered as a full-screen modal with a close X (back to the week or
 * /app). Gated server-side; the meal is loaded for the signed-in household + the
 * given plan/day. A stale plan/day shows a graceful "no longer in your week".
 *
 * Reuses the MealRating control and the submitMealFeedback write (#126): no
 * duplicated feedback logic, so a thumbs here folds into next week's taste exactly
 * as it does from the week view.
 */
export const Route = createFileRoute('/rate/$planId/$day')({
  beforeLoad: async () => requireUserBeforeLoad(),
  loader: async ({ params }): Promise<RateMealResult> =>
    loadRateMeal({ data: { planId: params.planId, day: params.day } }),
  component: RatePage,
})

function RatePage() {
  const data = Route.useLoaderData()
  const { planId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()

  /**
   * Close the modal. If there is somewhere to go back to (the user navigated here
   * in-app), go back; otherwise (the common case: a cold tap from a push
   * notification, no history) land on the week this meal belongs to.
   */
  function close() {
    if (router.history.length > 1) {
      router.history.back()
      return
    }
    void navigate({ to: '/week', search: { plan: planId } })
  }

  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background ios-scroll flex min-h-dvh flex-col"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <header className="flex items-center justify-between px-5 pt-4 pb-2">
          <h1 className="text-[1.5rem] leading-tight font-bold tracking-tight">
            Rate this meal
          </h1>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground bg-secondary inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {data.stale ? (
          <StaleMeal planId={planId} onClose={close} />
        ) : (
          <RateMealBody data={data} onClose={close} />
        )}
      </div>
    </SafeArea>
  )
}

/** The happy path: one dinner, its macros, and the thumbs control. */
function RateMealBody({
  data,
  onClose,
}: {
  data: Extract<RateMealResult, { stale: false }>
  onClose: () => void
}) {
  const [rating, setRating] = useState<Rating>(data.rating)
  const [note, setNote] = useState<string | null>(data.note)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  /**
   * Write the rating via the shared household-scoped server fn (the same write the
   * week view uses, #126), then reflect the stored state locally so the chosen
   * thumbs sticks. A successful rating shows a warm acknowledgement.
   */
  async function rate(next: { rating: Rating; note: string | null }) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await submitMealFeedback({
        data: {
          planId: data.planId,
          recipeId: data.recipeId,
          rating: next.rating,
          note: next.note,
        },
      })
      setRating(res.feedback?.rating ?? null)
      setNote(res.feedback?.note ?? null)
      setMessage(res.feedback ? 'Thanks, that shapes next week.' : null)
    } catch {
      setMessage('Could not save your rating, try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col px-5 pt-2 pb-8">
      <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
        <div className="bg-secondary aspect-[4/3] w-full">
          {data.imageUrl ? (
            <img
              src={data.imageUrl}
              alt={data.meal}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              <UtensilsCrossed className="h-10 w-10" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 px-4 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {data.day}
            </span>
            {data.cuisine && <Badge>{data.cuisine}</Badge>}
          </div>

          <h2 className="text-lg leading-snug font-semibold">{data.meal}</h2>

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {data.prepMinutes != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {data.prepMinutes} min
              </span>
            )}
            {data.calories != null && (
              <span className="inline-flex items-center gap-1">
                <Flame className="h-3.5 w-3.5" />
                {data.calories} kcal
              </span>
            )}
            {data.protein != null && (
              <span className="inline-flex items-center gap-1">
                <Beef className="h-3.5 w-3.5" />
                {data.protein}g protein
              </span>
            )}
          </div>

          <MealRating rating={rating} note={note} busy={busy} onSubmit={rate} />
        </div>
      </div>

      {message && (
        <div
          role="status"
          className="bg-secondary text-secondary-foreground mt-4 rounded-lg px-4 py-3 text-center text-sm"
        >
          {message}
        </div>
      )}

      <div className="mt-auto pt-6">
        <Button
          size="pill"
          variant="outline"
          className="w-full"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    </div>
  )
}

/** Graceful fallback: the plan/day no longer names a dinner in the week. */
function StaleMeal({
  planId,
  onClose,
}: {
  planId: string
  onClose: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
      <div className="bg-secondary text-muted-foreground mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <CalendarX className="h-8 w-8" />
      </div>
      <p className="text-lg font-semibold">
        This meal is no longer in your week
      </p>
      <p className="text-muted-foreground mt-1 max-w-xs text-sm">
        The plan changed since this reminder went out. Open your week to rate
        what you cooked.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link to="/week" search={{ plan: planId }}>
          <Button size="pill">Go to your week</Button>
        </Link>
        <Button size="pill" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
