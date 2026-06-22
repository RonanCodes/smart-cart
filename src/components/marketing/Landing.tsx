import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock, PiggyBank, Sparkles, Leaf, PartyPopper } from 'lucide-react'
import { joinWaitlist } from '#/lib/waitlist-server'
import { SafeArea } from '#/components/ui/safe-area'
import { Button, buttonVariants } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { StickyNote } from '#/components/ui/sticky-note'
import { BetaBadge } from '#/components/ui/beta-badge'
import { BETA_NOTE } from '#/lib/beta'
import { useLiveCount, useCountUp } from './use-live-count'

/**
 * Souso marketing landing: conversion-focused, mobile-first (390px), built for
 * a TikTok launch. In the Souso / Julienne look now: the wordmark, a row of
 * die-cut dish stickers as the hero, a hand-written note, cream + olive. The
 * waitlist email capture is the primary CTA; a quiet 'Log in' link at the bottom
 * lets already-approved users reach /login.
 *
 * Once the app is live (`launched`), the waitlist capture is replaced by a
 * "get started" CTA. EMAIL-LAST (TJ's design): "Get started" goes straight into
 * /onboarding (anonymous — no email prompt up front); the email is collected at
 * the END of the form. "Already have access? Log in" routes existing users to
 * sign-in.
 *
 * Mounted at the public entry route / (the swipe-deck opener is retired).
 */

/** Hero dish stickers (slug, sticker height class, tilt deg). */
const HERO = [
  { img: 'chicken-orzo', h: 'h-24', rot: -8 },
  { img: 'gnocchi-romesco', h: 'h-32', rot: 4 },
  { img: 'roast-veg', h: 'h-24', rot: 8 },
]

interface Benefit {
  icon: typeof Clock
  title: string
  body: string
}

const BENEFITS: Array<Benefit> = [
  {
    icon: Clock,
    title: 'Dinner decided in seconds',
    body: 'Tell Souso who you are cooking for. It plans the week and writes the shopping list. No more 6pm "what is for dinner" panic.',
  },
  {
    icon: PiggyBank,
    title: 'Spend less, waste less',
    body: 'Meals reuse the ingredients you already bought, so less ends up forgotten at the back of the fridge and in the bin.',
  },
  {
    icon: Sparkles,
    title: 'It learns what you love',
    body: 'Every swipe and every thumbs-up teaches Souso your taste. The plans get more "yes, that one" each week.',
  },
]

/**
 * Below this, the social-proof line stays hidden. Kept at 1 so the count shows
 * as soon as there is a real signed-up user (it only hides at 0, where "0 home
 * cooks" would read worse than no line at all).
 */
const SOCIAL_PROOF_MIN = 1

export function Landing({
  launched = false,
  userCount = 0,
  signInTo = '/onboarding',
  loginTo = '/login',
}: {
  launched?: boolean
  /** Total registered users, from the public getUserCount server fn. Drives the
   * social-proof line; hidden below SOCIAL_PROOF_MIN. */
  userCount?: number
  /** Where the "Get started" CTA points. EMAIL-LAST: defaults to /onboarding so
   * a visitor runs the form first and gives their email at the end. Overridden
   * by the design prototype so the walkthrough stays inside /design/* instead of
   * jumping to real onboarding. */
  signInTo?: string
  /** Where the "Already have access? Log in" link points (same reason). */
  loginTo?: string
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)

  // Live counter: open a WebSocket to the CounterDO, seeded with the SSR
  // userCount, and ease the displayed number up as people sign up. Degrades to
  // the static SSR count if the socket can't open (see useLiveCount).
  const liveCount = useLiveCount(userCount)
  const displayCount = useCountUp(liveCount)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('busy')
    setError(null)
    try {
      await joinWaitlist({ data: { email } })
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setError(
        err instanceof Error ? err.message : 'Something went wrong. Try again.',
      )
    }
  }

  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background text-foreground"
    >
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-16">
        {/* Hero */}
        <section className="pt-8 text-center">
          {/* Wordmark stays dead-centre; the Beta tag sits quietly under it so it
              never pushes the mark off-centre (#407). */}
          <div className="flex flex-col items-center gap-1.5">
            <img src="/souso-mark.svg" alt="Souso" className="h-11 w-auto" />
            <BetaBadge />
          </div>

          {/* A little board of dishes. */}
          <div className="relative mt-7 flex items-end justify-center gap-2">
            {HERO.map((s) => (
              <img
                key={s.img}
                src={`/stickers/recipes/${s.img}.png`}
                alt=""
                aria-hidden
                className={`souso-sticker ${s.h} w-auto object-contain`}
                style={{ transform: `rotate(${s.rot}deg)` }}
              />
            ))}
            <StickyNote tilt={6} className="absolute -top-3 right-0">
              no more &ldquo;what&rsquo;s for dinner?&rdquo;
            </StickyNote>
          </div>

          <h1
            className="mt-8 text-[2.5rem] leading-[1.02] font-bold"
            style={{ letterSpacing: '-0.03em' }}
          >
            Groceries, sorted.
          </h1>
          <p className="text-muted-foreground mt-3 text-base">
            Souso plans your whole week of dinners and fills a ready-to-order
            basket. Save time, spend less, waste less food.
          </p>
          {liveCount >= SOCIAL_PROOF_MIN && (
            <p
              className="text-primary mt-4 text-sm font-semibold"
              aria-live="polite"
            >
              {displayCount.toLocaleString('en')} home cooks planning with Souso
            </p>
          )}
          <p className="text-muted-foreground mx-auto mt-4 max-w-sm text-xs">
            {BETA_NOTE}
          </p>
        </section>

        {/* Primary CTA: once live, a "get started" button into sign-in; before
            launch, the waitlist capture. */}
        <section className="border-hairline bg-card mt-8 rounded-[var(--radius-ios)] border p-6 shadow-[0_1px_3px_rgba(22,52,31,0.05),0_14px_34px_-18px_rgba(22,52,31,0.25)]">
          {launched ? (
            <div className="flex flex-col items-center text-center">
              <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full">
                <PartyPopper className="h-7 w-7" />
              </div>
              <p className="mt-4 text-lg font-bold">We&apos;re live</p>
              <p className="text-muted-foreground mt-2 text-sm">
                Souso is open. Plan your week and build your shopping list in
                minutes.
              </p>
              <Link
                to={signInTo}
                className={buttonVariants({
                  size: 'pill',
                  className: 'mt-4 w-full',
                })}
              >
                Get started
              </Link>
            </div>
          ) : status === 'done' ? (
            <div className="flex flex-col items-center text-center">
              <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full">
                <Leaf className="h-7 w-7" />
              </div>
              <p className="mt-4 text-lg font-bold">You are on the list</p>
              <p className="text-muted-foreground mt-2 text-sm">
                We will email you the moment your spot opens. Souso is cooking
                up something good.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="text-center">
                <h2
                  className="text-xl font-bold"
                  style={{ letterSpacing: '-0.02em' }}
                >
                  Join the waitlist
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Be first in line when Souso opens. No spam, just your invite.
                </p>
              </div>
              <Input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-full text-base"
                disabled={status === 'busy'}
              />
              <Button
                type="submit"
                size="pill"
                className="w-full"
                disabled={status === 'busy'}
              >
                {status === 'busy' ? 'Joining…' : 'Join the waitlist'}
              </Button>
              {status === 'error' && error && (
                <p className="text-destructive text-center text-sm">{error}</p>
              )}
            </form>
          )}
        </section>

        {/* Benefits */}
        <section className="mt-10 space-y-6">
          {BENEFITS.map((b) => {
            const Icon = b.icon
            return (
              <div key={b.title} className="flex gap-4">
                <div className="bg-secondary text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold">{b.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{b.body}</p>
                </div>
              </div>
            )
          })}
        </section>

        {/* The learning loop, told simply */}
        <section className="border-hairline mt-10 border-t pt-8 text-center">
          <p className="font-handwriting text-primary text-[1.4rem] leading-snug">
            Recipes first, guesswork last.
          </p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">
            The more you cook with Souso, the better it knows you.
          </p>
        </section>

        {/* Discrete entry for already-approved users. */}
        <div className="mt-10 text-center">
          <Link
            to={loginTo}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition hover:underline"
          >
            Already have access? Log in
          </Link>
        </div>
      </div>
    </SafeArea>
  )
}
