import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock, PiggyBank, Sparkles, Leaf } from 'lucide-react'
import { joinWaitlist } from '#/lib/waitlist-server'
import { SafeArea } from '#/components/ui/safe-area'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

/**
 * Souso marketing landing: conversion-focused, mobile-first (390px), built for
 * a TikTok launch. Hero + mascot reference brand assets by URL (committed by the
 * mascot agent, not here). A prominent waitlist email capture is the primary CTA;
 * a small, discrete 'Log in' link at the very bottom lets already-approved users
 * reach /login without the waitlist drowning it out.
 *
 * Mounted at the public entry route / (the swipe-deck opener is retired).
 */

const MASCOT_IMAGE = '/brand/souso-v3-hello.png'

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

export function Landing() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)

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
        <section className="flex flex-col items-center pt-10 text-center">
          <img
            src={MASCOT_IMAGE}
            alt="Souso, your sous-chef helper"
            className="mb-5 h-24 w-24 object-contain"
          />
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight">
            Your sous-chef for the whole week
          </h1>
          <p className="text-muted-foreground mt-3 text-base">
            Souso turns real recipes into a done-for-you meal plan and shopping
            list. Save time, save money, waste less food.
          </p>
        </section>

        {/* Primary CTA: waitlist */}
        <section className="bg-card mt-8 rounded-[var(--radius-ios)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
          {status === 'done' ? (
            <div className="text-center">
              <p className="text-lg font-semibold">You are on the list</p>
              <p className="text-muted-foreground mt-2 text-sm">
                We will email you the moment your spot opens. Souso is cooking
                up something good.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="text-center">
                <h2 className="text-xl font-bold">Join the waitlist</h2>
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
                className="h-12 text-base"
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
        <section className="mt-10 space-y-5">
          {BENEFITS.map((b) => {
            const Icon = b.icon
            return (
              <div key={b.title} className="flex gap-4">
                <div className="bg-secondary text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold">{b.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{b.body}</p>
                </div>
              </div>
            )
          })}
        </section>

        {/* The learning loop, told simply */}
        <section className="bg-secondary/50 mt-10 rounded-[var(--radius-ios)] p-6 text-center">
          <Leaf className="text-primary mx-auto mb-2 h-6 w-6" />
          <p className="text-sm font-medium">
            The more you cook with Souso, the better it knows you. Recipes
            first, guesswork last.
          </p>
        </section>

        {/* Discrete entry for already-approved users. Kept quiet so the
            waitlist stays the primary CTA. */}
        <div className="mt-10 text-center">
          <Link
            to="/login"
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition hover:underline"
          >
            Already have access? Log in
          </Link>
        </div>
      </div>
    </SafeArea>
  )
}
