import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Plus, Minus, ChefHat } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'

/**
 * DESIGN PREVIEW (throwaway) — /design/recipe. The Julienne recipe sheet against
 * dummy data: a hero die-cut dish sticker, facts, and an ingredient list where
 * every item carries its own cut-out product sticker. Delete before shipping.
 */

const INGREDIENTS: Array<{ name: string; amount: string; sticker: string }> = [
  { name: 'Chicken thigh', amount: '500 g', sticker: 'chicken' },
  { name: 'Orzo', amount: '300 g', sticker: 'pasta' },
  { name: 'Baby spinach', amount: '200 g', sticker: 'spinach' },
  { name: 'Sun-dried tomatoes', amount: '100 g', sticker: 'tomato' },
  { name: 'Garlic', amount: '3 cloves', sticker: 'garlic' },
  { name: 'Parmesan', amount: '50 g', sticker: 'parmesan' },
  { name: 'Lemon', amount: '1', sticker: 'lemon' },
  { name: 'Olive oil', amount: '2 tbsp', sticker: 'olive-oil' },
]

const STEPS = [
  'Sear the chicken thighs until golden, then set aside to rest.',
  'Toast the orzo in the same pan with garlic and olive oil.',
  'Add stock and sun-dried tomatoes; simmer until the orzo is creamy.',
  'Fold through spinach and parmesan, slice the chicken back in, finish with lemon.',
]

export const Route = createFileRoute('/design/recipe')({
  component: DesignRecipe,
})

function DesignRecipe() {
  const [servings, setServings] = useState(4)
  const navigate = useNavigate()

  return (
    <div className="bg-background text-foreground mx-auto flex min-h-dvh max-w-md flex-col">
      <div className="flex-1 overflow-y-auto px-5 pb-32">
        {/* Top bar */}
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate({ to: '/design/week' })}
            className="border-border bg-card flex h-10 w-10 items-center justify-center rounded-full border transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-muted-foreground text-xs font-semibold">
            Wednesday&rsquo;s dinner
          </span>
        </div>

        {/* Hero dish sticker */}
        <div className="relative flex justify-center pt-2 pb-1">
          <img
            src="/stickers/recipes/chicken-orzo.png"
            alt="Chicken Orzo with Spinach"
            className="souso-sticker h-52 w-52 object-contain"
            style={{ transform: 'rotate(-4deg)' }}
          />
          <StickyNote
            tilt={6}
            className="absolute top-4 right-1 text-[0.95rem]"
          >
            a household favourite ✶
          </StickyNote>
        </div>

        <h1
          className="text-center text-[1.9rem] leading-tight font-bold"
          style={{ letterSpacing: '-0.03em' }}
        >
          Chicken Orzo with Spinach
        </h1>
        <p className="text-muted-foreground mt-1 text-center text-sm">
          a creamy one-pan dinner, ready in 25 minutes
        </p>

        {/* Facts */}
        <div className="border-hairline mt-5 grid grid-cols-4 gap-2 border-y py-3 text-center">
          {[
            ['Skill', 'Easy'],
            ['Time', '25m'],
            ['Items', '8'],
            ['Per serve', '540'],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-muted-foreground text-[0.6rem] font-bold tracking-[0.12em] uppercase">
                {k}
              </p>
              <p className="mt-0.5 text-sm font-bold">{v}</p>
            </div>
          ))}
        </div>

        {/* Ingredients with images */}
        <div className="mt-6 flex items-center justify-between">
          <h2
            className="text-lg font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            Ingredients
          </h2>
          <button
            type="button"
            className="border-primary text-primary inline-flex items-center gap-1.5 rounded-full border bg-transparent px-3.5 py-1.5 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Add all
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {INGREDIENTS.map((ing) => (
            <div
              key={ing.name}
              className="border-border bg-card flex items-center gap-2.5 rounded-2xl border p-2 shadow-sm"
            >
              <div className="bg-secondary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                <img
                  src={`/stickers/ingredients/${ing.sticker}.png`}
                  alt=""
                  aria-hidden
                  className="souso-sticker h-8 w-8 object-contain"
                  style={{ transform: 'rotate(-3deg)' }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] font-semibold">
                  {ing.name}
                </p>
                <p className="text-muted-foreground text-[0.7rem]">
                  {ing.amount}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Steps with ghosted numbers */}
        <h2
          className="mt-7 mb-1 text-lg font-bold"
          style={{ letterSpacing: '-0.02em' }}
        >
          Steps
        </h2>
        <div>
          {STEPS.map((step, i) => (
            <div
              key={i}
              className="border-hairline flex gap-3 border-b py-3.5 last:border-b-0"
            >
              <span
                className="text-foreground/15 leading-none font-extrabold"
                style={{ fontSize: '1.6rem', letterSpacing: '-0.04em' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="text-foreground/80 pt-0.5 text-sm leading-relaxed">
                {step}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky footer: servings + cook */}
      <div className="border-hairline bg-background/95 fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 border-t px-5 pt-3 pb-7 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="border-border flex items-center gap-3 rounded-full border px-2 py-1.5">
            <button
              type="button"
              aria-label="Fewer servings"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              className="text-muted-foreground flex h-7 w-7 items-center justify-center"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-12 text-center text-sm font-semibold tabular-nums">
              {servings} serves
            </span>
            <button
              type="button"
              aria-label="More servings"
              onClick={() => setServings((s) => s + 1)}
              className="text-primary flex h-7 w-7 items-center justify-center"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <Button size="pill" className="flex-1">
            <ChefHat className="h-5 w-5" />
            Cook
          </Button>
        </div>
      </div>
    </div>
  )
}
