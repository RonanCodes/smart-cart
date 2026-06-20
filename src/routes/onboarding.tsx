import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Heart, X, UtensilsCrossed, Sparkles, Clock } from 'lucide-react'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { getOnboardingDeck, finishOnboarding } from '#/lib/onboarding-server'
import type { DeckCard } from '#/lib/recsys-data'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireUserBeforeLoad,
  component: Onboarding,
})

type Swipe = { recipeId: string; like: boolean }
const ENOUGH = 8 // can finish after this many swipes
const TARGET = 15 // a full read

function Onboarding() {
  const [queue, setQueue] = useState<Array<DeckCard>>([])
  const [swipes, setSwipes] = useState<Array<Swipe>>([])
  const [finishing, setFinishing] = useState(false)
  const [ready, setReady] = useState(false)
  const seen = useRef(new Set<string>())
  const loadingMore = useRef(false)

  const loadMore = useCallback(async (current: Array<Swipe>) => {
    if (loadingMore.current) return
    loadingMore.current = true
    try {
      const deck = await getOnboardingDeck({ data: { swipes: current, k: 8 } })
      const fresh = deck.filter((c) => !seen.current.has(c.id))
      for (const c of fresh) seen.current.add(c.id)
      setQueue((q) => [...q, ...fresh])
    } finally {
      loadingMore.current = false
    }
  }, [])

  useEffect(() => {
    void loadMore([]).then(() => setReady(true))
  }, [loadMore])

  function swipe(card: DeckCard, like: boolean) {
    const next = [...swipes, { recipeId: card.id, like }]
    setSwipes(next)
    setQueue((q) => q.filter((c) => c.id !== card.id))
    if (queue.length <= 3) void loadMore(next)
  }

  async function finish() {
    setFinishing(true)
    await finishOnboarding({ data: { swipes } })
    window.location.href = '/app'
  }

  const card = queue[0]
  const count = swipes.length
  const pct = Math.min(100, (count / TARGET) * 100)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-bold">
            <Sparkles className="text-primary h-5 w-5" />
            Tell us what you like
          </span>
          <span className="text-muted-foreground text-sm">{count} swipes</span>
        </div>
        <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          Swipe a few dinners. The more you rate, the better your first week.
        </p>
      </header>

      <div className="relative mt-6 flex-1">
        {card ? (
          <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
            <div className="bg-secondary aspect-[4/3] w-full">
              {card.imageUrl ? (
                <img
                  src={card.imageUrl}
                  alt={card.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center">
                  <UtensilsCrossed className="h-10 w-10" />
                </div>
              )}
            </div>
            <div className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {card.cuisine && <Badge>{card.cuisine}</Badge>}
                {card.prepMinutes != null && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                    <Clock className="h-3.5 w-3.5" />
                    {card.prepMinutes} min
                  </span>
                )}
              </div>
              <h2 className="text-xl leading-tight font-semibold">
                {card.title}
              </h2>
              {card.ingredients.length > 0 && (
                <p className="text-muted-foreground text-sm leading-snug">
                  {card.ingredients.join(' · ')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            {ready ? 'Loading more…' : 'Finding recipes…'}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-6">
        <button
          aria-label="Not for me"
          disabled={!card || finishing}
          onClick={() => card && swipe(card, false)}
          className="border-border flex h-16 w-16 items-center justify-center rounded-full border bg-white text-red-500 shadow-sm transition active:scale-95 disabled:opacity-40"
        >
          <X className="h-7 w-7" />
        </button>
        <button
          aria-label="Love it"
          disabled={!card || finishing}
          onClick={() => card && swipe(card, true)}
          className="bg-primary text-primary-foreground flex h-16 w-16 items-center justify-center rounded-full shadow-sm transition active:scale-95 disabled:opacity-40"
        >
          <Heart className="h-7 w-7" />
        </button>
      </div>

      <Button
        className="mt-6 w-full"
        size="lg"
        disabled={count < ENOUGH || finishing}
        onClick={finish}
      >
        {finishing
          ? 'Building your week…'
          : count < ENOUGH
            ? `Swipe ${ENOUGH - count} more to continue`
            : 'See my week'}
      </Button>
    </main>
  )
}
