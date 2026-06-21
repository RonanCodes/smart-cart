import * as React from 'react'
import { HeartHandshake, Search, ChefHat } from 'lucide-react'
import { Button } from '#/components/ui/button'

/**
 * IntroCarousel — the Souso-branded value slides that open onboarding. Three
 * full-screen slides with paging dots and a persistent 'Get started' CTA (plus a
 * quieter 'I have an account' link). Swipeable on touch and tappable via the
 * dots; the CTA on the last slide is the primary path into the stepped form.
 *
 * iOS-native: big tap targets, safe-area handled by the parent route, mobile
 * first at 390px.
 */

interface Slide {
  icon: React.ReactNode
  title: string
  body: string
}

const SLIDES: readonly [Slide, ...Array<Slide>] = [
  {
    icon: <HeartHandshake aria-hidden className="h-10 w-10" />,
    title: 'Meals that cater to your needs',
    body: 'Tell Souso how your household eats once. Every week of recipes respects it.',
  },
  {
    icon: <Search aria-hidden className="h-10 w-10" />,
    title: 'Find recipes, build the basket',
    body: 'Souso picks dinners you will love and fills a ready-to-order basket at Albert Heijn.',
  },
  {
    icon: <ChefHat aria-hidden className="h-10 w-10" />,
    title: 'Easy to cook',
    body: 'Recipes matched to your kitchen and your week. You just cook and check out.',
  },
]

export function IntroCarousel({
  onGetStarted,
  onSignIn,
}: {
  onGetStarted: () => void
  onSignIn?: () => void
}) {
  const [index, setIndex] = React.useState(0)
  const touchStartX = React.useRef<number | null>(null)
  const last = SLIDES.length - 1

  function go(next: number) {
    setIndex(Math.max(0, Math.min(last, next)))
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current
    touchStartX.current = null
    if (start == null) return
    const dx = (e.changedTouches[0]?.clientX ?? start) - start
    if (Math.abs(dx) < 40) return
    go(dx < 0 ? index + 1 : index - 1)
  }

  const slide = SLIDES[index] ?? SLIDES[0]
  // SLIDES is a non-empty tuple, so SLIDES[0] is always defined; the fallback
  // narrows `slide` for noUncheckedIndexedAccess.

  return (
    <div
      className="flex flex-1 flex-col px-6 pt-10 pb-8"
      data-testid="intro-carousel"
    >
      <div
        className="flex flex-1 flex-col items-center justify-center text-center"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="bg-secondary text-primary mb-8 flex h-24 w-24 items-center justify-center rounded-[var(--radius-ios)]">
          {slide.icon}
        </div>
        <h1 className="text-[1.9rem] leading-tight font-bold tracking-tight">
          {slide.title}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-xs text-base">
          {slide.body}
        </p>
      </div>

      <div
        className="mt-8 flex items-center justify-center gap-2"
        role="tablist"
        aria-label="Intro slides"
      >
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${s.title}`}
            onClick={() => go(i)}
            className={`h-2 rounded-full transition-all ${
              i === index ? 'bg-primary w-6' : 'bg-secondary w-2'
            }`}
          />
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <Button size="pill" onClick={onGetStarted}>
          Get started
        </Button>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="text-muted-foreground h-11 w-full text-sm font-medium"
          >
            I have an account
          </button>
        )}
      </div>
    </div>
  )
}
