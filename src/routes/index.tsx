import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { getPublicDeck } from '#/lib/public-deck-server'
import { hasHousehold } from '#/lib/onboarding-server'
import { resolveSessionUserOrNull } from '#/lib/route-guards'
import type { DeckCard } from '#/lib/recsys-data'
import { readAnonSwipes, writeAnonSwipes } from '#/lib/anon-swipes'
import type { AnonSwipe } from '#/lib/anon-swipes'
import { SwipeDeck } from '#/components/swipe-deck'
import { SafeArea } from '#/components/ui/safe-area'
import { Button } from '#/components/ui/button'

/** Swipe at least this many before "Save my week" unlocks. */
const ENOUGH = 8
/** A full read; drives the progress bar. */
const TARGET = 15

export const Route = createFileRoute('/')({
  // Swipe-first: anyone NOT yet onboarded stays here and swipes anonymously. A
  // signed-in user who already has a household skips the opener and lands in the
  // app. (A signed-in but not-onboarded user can keep swiping here, then sign in
  // is a no-op and finishOnboarding persists their batch.)
  beforeLoad: async () => {
    const user = await resolveSessionUserOrNull()
    if (user && (await hasHousehold())) throw redirect({ to: '/app' })
  },
  component: Opener,
})

function Opener() {
  const [queue, setQueue] = useState<Array<DeckCard>>([])
  const [swipes, setSwipes] = useState<Array<AnonSwipe>>([])
  const [ready, setReady] = useState(false)
  const seen = useRef(new Set<string>())
  const loadingMore = useRef(false)

  const loadMore = useCallback(async (current: Array<AnonSwipe>) => {
    if (loadingMore.current) return
    loadingMore.current = true
    try {
      const deck = await getPublicDeck({ data: { swipes: current, k: 8 } })
      const fresh = deck.filter((c) => !seen.current.has(c.id))
      for (const c of fresh) seen.current.add(c.id)
      setQueue((q) => [...q, ...fresh])
    } finally {
      loadingMore.current = false
    }
  }, [])

  // Restore any swipes the visitor already made this session (e.g. they bounced
  // off the sign-in page and came back), then load the first batch from them.
  useEffect(() => {
    const held = readAnonSwipes()
    setSwipes(held)
    void loadMore(held).then(() => setReady(true))
    // run once on mount
  }, [])

  function swipe(card: DeckCard, like: boolean) {
    const next = [...swipes, { recipeId: card.id, like }]
    setSwipes(next)
    writeAnonSwipes(next)
    setQueue((q) => q.filter((c) => c.id !== card.id))
    if (queue.length <= 3) void loadMore(next)
  }

  const card = queue[0]
  const count = swipes.length
  const pct = Math.min(100, (count / TARGET) * 100)
  const enough = count >= ENOUGH

  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background flex flex-col"
    >
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-bold">
              <Sparkles className="text-primary h-5 w-5" />
              What would you eat?
            </span>
            <span className="text-muted-foreground text-sm">
              {count} swipes
            </span>
          </div>
          <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            Swipe a few dinners. No account needed. Sign in at the end to save
            your week.
          </p>
        </header>

        <div className="mt-6 flex flex-1 flex-col">
          <SwipeDeck card={card} ready={ready} onSwipe={swipe} />
        </div>

        <div className="mt-6 space-y-3">
          <Link
            to="/sign-in"
            search={{ from: 'opener' }}
            className="block"
            disabled={!enough}
            aria-disabled={!enough}
          >
            <Button className="w-full" size="lg" disabled={!enough}>
              {enough ? 'Save my week' : `Swipe ${ENOUGH - count} more to save`}
            </Button>
          </Link>
        </div>
      </main>
    </SafeArea>
  )
}
