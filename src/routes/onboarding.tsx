import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Sparkles, Minus, Plus, Users } from 'lucide-react'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { getOnboardingDeck, finishOnboarding } from '#/lib/onboarding-server'
import type { DeckCard } from '#/lib/recsys-data'
import { SwipeDeck } from '#/components/swipe-deck'
import { Button } from '#/components/ui/button'
import { DAY_LABELS, clampHouseholdCount } from '#/lib/onboarding-rhythm'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireUserBeforeLoad,
  component: Onboarding,
})

type Swipe = { recipeId: string; like: boolean }
const ENOUGH = 8 // can finish after this many swipes
const TARGET = 15 // a full read

type Phase = 'swipe' | 'questions'

function Onboarding() {
  const [queue, setQueue] = useState<Array<DeckCard>>([])
  const [swipes, setSwipes] = useState<Array<Swipe>>([])
  const [finishing, setFinishing] = useState(false)
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<Phase>('swipe')
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [cookDays, setCookDays] = useState<Array<number>>([])
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

  function toggleCookDay(day: number) {
    setCookDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    )
  }

  async function finish() {
    setFinishing(true)
    await finishOnboarding({
      data: {
        swipes,
        householdSize: { adults, children },
        cookDays,
      },
    })
    window.location.href = '/app'
  }

  const card = queue[0]
  const count = swipes.length
  const pct = Math.min(100, (count / TARGET) * 100)

  if (phase === 'questions') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6">
        <header className="space-y-2">
          <span className="flex items-center gap-2 font-bold">
            <Users className="text-primary h-5 w-5" />A couple of quick
            questions
          </span>
          <p className="text-muted-foreground text-sm">
            This sizes your portions and sets which days we plan a dinner.
          </p>
        </header>

        <section className="mt-8 space-y-6">
          <div className="space-y-3">
            <h2 className="font-semibold">Who's eating?</h2>
            <Stepper
              label="Adults"
              value={adults}
              min={1}
              onChange={setAdults}
            />
            <Stepper
              label="Children"
              value={children}
              min={0}
              onChange={setChildren}
            />
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold">Which days do you usually cook?</h2>
            <p className="text-muted-foreground text-sm">
              We'll plan a dinner on these days. Leave all unticked to plan
              every day.
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {DAY_LABELS.map((label, day) => {
                const on = cookDays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCookDay(day)}
                    className={`flex h-12 flex-col items-center justify-center rounded-lg border text-xs font-medium transition active:scale-95 ${
                      on
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-muted-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <div className="mt-auto space-y-3 pt-8">
          <Button
            className="w-full"
            size="lg"
            disabled={finishing}
            onClick={finish}
          >
            {finishing ? 'Building your week…' : 'Build my week'}
          </Button>
          <button
            type="button"
            disabled={finishing}
            onClick={() => setPhase('swipe')}
            className="text-muted-foreground w-full text-sm disabled:opacity-40"
          >
            Back to swiping
          </button>
        </div>
      </main>
    )
  }

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

      <div className="mt-6 flex flex-1 flex-col">
        <SwipeDeck
          card={card}
          ready={ready}
          disabled={finishing}
          onSwipe={swipe}
        />
      </div>

      <Button
        className="mt-6 w-full"
        size="lg"
        disabled={count < ENOUGH || finishing}
        onClick={() => setPhase('questions')}
      >
        {count < ENOUGH
          ? `Swipe ${ENOUGH - count} more to continue`
          : 'Next: a couple of questions'}
      </Button>
    </main>
  )
}

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string
  value: number
  min: number
  onChange: (next: number) => void
}) {
  return (
    <div className="border-border flex items-center justify-between rounded-xl border px-4 py-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clampHouseholdCount(value - 1, min))}
          className="border-border flex h-9 w-9 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-40"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">
          {value}
        </span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(clampHouseholdCount(value + 1, min))}
          className="border-border flex h-9 w-9 items-center justify-center rounded-full border transition active:scale-95"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
