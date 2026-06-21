import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import {
  ShoppingBasket,
  Sparkles,
  Send,
  Plus,
  ChefHat,
  CalendarPlus,
} from 'lucide-react'
import { ScreenHeader } from '#/components/ui/app-shell'
import { DesignShell } from '#/components/design/design-shell'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'
import { DayCard } from '#/components/week/DayCard'
import type { WeekDayView } from '#/lib/week-server'

/**
 * DESIGN PREVIEW (throwaway) — /design/week. The Souso week menu against dummy
 * data: card-less rows (dish sticker + title + ingredients + quiet actions),
 * a subtle AI prompt, a "you might also like" tail, and a floating basket CTA.
 */

const noop = async () => {}

type Meal = WeekDayView & {
  ingredients: Array<string>
  note?: string
  /** The dish + its alternatives, staged behind it for swipe-to-swap. */
  options: Array<WeekDayView>
}

/** Build one dish option (a WeekDayView) from a sticker slug. */
function dish(
  day: string,
  meal: string,
  slug: string,
  prepMinutes: number,
  calories: number,
  protein: number,
  cuisine: string,
): WeekDayView {
  // A plausible per-serving price, derived so each dish reads a little different.
  const euros = (2 + (calories % 250) / 100).toFixed(2).replace('.', ',')
  return {
    day,
    meal,
    recipeRef: slug,
    cuisine,
    prepMinutes,
    calories,
    protein,
    imageUrl: `/stickers/recipes/${slug}.png`,
    videoUrl: null,
    price: `€${euros} pp`,
    alternatives: [],
  }
}

/** A day = its current dish (options[0]) plus a couple of ready alternatives. */
function plan(
  options: Array<WeekDayView>,
  ingredients: Array<string>,
  note?: string,
): Meal {
  return { ...options[0]!, ingredients, note, options }
}

const DAYS: Array<Meal> = [
  plan(
    [
      dish(
        'Monday',
        'Chicken Orzo with Spinach',
        'chicken-orzo',
        25,
        540,
        32,
        'Mediterranean',
      ),
      dish(
        'Monday',
        'One-pan Tomato Pasta',
        'one-pan-pasta',
        20,
        580,
        18,
        'Italian',
      ),
      dish(
        'Monday',
        'Veggie Lasagne',
        'veggie-lasagne',
        55,
        600,
        24,
        'Italian',
      ),
    ],
    [
      'Chicken',
      'Orzo',
      'Spinach',
      'Sun-dried tomato',
      'Garlic',
      'Parmesan',
      'Lemon',
    ],
    'a keeper ✶',
  ),
  plan(
    [
      dish(
        'Tuesday',
        'Gnocchi in Romesco',
        'gnocchi-romesco',
        30,
        650,
        22,
        'Spanish',
      ),
      dish(
        'Tuesday',
        'Creamy Tuscan Orecchiette',
        'orecchiette',
        25,
        640,
        26,
        'Italian',
      ),
      dish(
        'Tuesday',
        'Sheet-pan Roast Veg & Feta',
        'roast-veg',
        35,
        480,
        18,
        'Vegetarian',
      ),
    ],
    ['Gnocchi', 'Romesco', 'Cauliflower', 'Chives', 'Parmesan'],
  ),
  plan(
    [
      dish(
        'Wednesday',
        'Chicken Skewers & Tomato Salad',
        'chicken-skewers',
        20,
        610,
        40,
        'Greek',
      ),
      dish(
        'Wednesday',
        'Chicken Orzo with Spinach',
        'chicken-orzo',
        25,
        540,
        32,
        'Mediterranean',
      ),
      dish(
        'Wednesday',
        'Gnocchi in Romesco',
        'gnocchi-romesco',
        30,
        650,
        22,
        'Spanish',
      ),
    ],
    ['Chicken', 'Cherry tomato', 'Red onion', 'Basil', 'Lemon'],
  ),
  plan(
    [
      dish(
        'Thursday',
        'Creamy Tuscan Orecchiette',
        'orecchiette',
        25,
        640,
        26,
        'Italian',
      ),
      dish(
        'Thursday',
        'Veggie Lasagne',
        'veggie-lasagne',
        55,
        600,
        24,
        'Italian',
      ),
      dish(
        'Thursday',
        'One-pan Tomato Pasta',
        'one-pan-pasta',
        20,
        580,
        18,
        'Italian',
      ),
    ],
    ['Orecchiette', 'Sun-dried tomato', 'Spinach', 'Cream', 'Parmesan'],
    'kids loved it!',
  ),
  plan(
    [
      dish(
        'Friday',
        'Sheet-pan Roast Veg & Feta',
        'roast-veg',
        35,
        480,
        18,
        'Vegetarian',
      ),
      dish(
        'Friday',
        'One-pan Tomato Pasta',
        'one-pan-pasta',
        20,
        580,
        18,
        'Italian',
      ),
      dish(
        'Friday',
        'Gnocchi in Romesco',
        'gnocchi-romesco',
        30,
        650,
        22,
        'Spanish',
      ),
    ],
    ['Potato', 'Leek', 'Cherry tomato', 'Feta', 'Thyme'],
  ),
]

const SUGGESTIONS = [
  {
    title: 'Veggie Lasagne',
    img: '/stickers/recipes/veggie-lasagne.png',
    ingredients: 'Lasagne, ricotta, tomato, spinach, mozzarella',
  },
  {
    title: 'Apple Crumble',
    img: '/stickers/recipes/apple-crumble.png',
    ingredients: 'Apple, oats, butter, cinnamon, vanilla ice cream',
  },
]

export const Route = createFileRoute('/design/week')({
  beforeLoad: requireAdminBeforeLoad,
  validateSearch: (s: Record<string, unknown>): { state?: string } =>
    typeof s.state === 'string' ? { state: s.state } : {},
  component: DesignWeek,
})

function DesignWeek() {
  const [aiText, setAiText] = useState('')
  const navigate = useNavigate()
  const { state } = Route.useSearch()
  const openRecipe = () => navigate({ to: '/design/recipe' })

  if (state === 'loading') {
    return (
      <DesignShell>
        <ScreenHeader
          title="Your week"
          subtitle="Cooking up five dinners around your taste…"
        />
        <div className="px-5 pt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="border-hairline flex items-center gap-4 border-b border-dashed py-5 last:border-b-0"
            >
              <div className="bg-secondary/70 h-28 w-28 shrink-0 animate-pulse rounded-2xl" />
              <div className="flex-1 space-y-2.5">
                <div className="bg-secondary/70 h-3 w-16 animate-pulse rounded-full" />
                <div className="bg-secondary/70 h-5 w-40 animate-pulse rounded-full" />
                <div className="bg-secondary/70 h-3 w-32 animate-pulse rounded-full" />
                <div className="bg-secondary/70 mt-3 h-7 w-24 animate-pulse rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </DesignShell>
    )
  }

  if (state === 'empty') {
    return (
      <DesignShell>
        <ScreenHeader title="Your week" />
        <div className="flex flex-col items-center px-8 pt-16 text-center">
          <div className="relative">
            <img
              src="/stickers/recipes/roast-veg.png"
              alt=""
              aria-hidden
              className="souso-sticker h-32 w-32 object-contain opacity-90"
              style={{ transform: 'rotate(-6deg)' }}
            />
            <StickyNote tilt={6} className="absolute -top-2 -right-6">
              let&rsquo;s fix that
            </StickyNote>
          </div>
          <h2
            className="mt-6 text-2xl font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            No dinners planned yet
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Tell Souso who&rsquo;s eating and it builds a full week in seconds.
          </p>
          <Button
            size="pill"
            className="mt-6 max-w-xs"
            onClick={() => navigate({ to: '/design/week' })}
          >
            <CalendarPlus className="h-5 w-5" />
            Plan my week
          </Button>
        </div>
      </DesignShell>
    )
  }

  return (
    <DesignShell>
      <ScreenHeader
        title="Your week"
        subtitle="Five dinners, planned for you. Swipe a dish to swap it."
      />

      <div className="px-5 pt-3">
        <div className="border-border bg-card focus-within:border-primary flex w-full items-center gap-2 rounded-full border px-3.5 py-2.5 shadow-sm transition">
          <Sparkles className="text-primary h-4 w-4 shrink-0" aria-hidden />
          <input
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder="Ask Souso to tweak your week…"
            aria-label="Ask Souso to tweak your week"
            className="placeholder:text-muted-foreground/80 w-full bg-transparent text-[0.88rem] outline-none"
          />
          <button
            type="button"
            aria-label="Send to Souso"
            className="text-primary shrink-0 transition active:scale-90"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['Eating out Wed', 'Make it cheaper', 'More veggies', 'No fish'].map(
            (t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAiText(t)}
                className="border-border bg-card text-muted-foreground rounded-full border px-2.5 py-1 text-[0.72rem] font-medium shadow-sm transition active:scale-95"
              >
                {t}
              </button>
            ),
          )}
        </div>

        <div className="mt-6">
          {DAYS.map((d) => (
            <DayCard
              key={d.day}
              day={d}
              swapOptions={d.options}
              ingredients={d.ingredients}
              note={d.note}
              busy={false}
              locked={false}
              onEdit={openRecipe}
              onAdd={openRecipe}
              onSwap={noop}
              onLoadSimilar={async () => []}
              onPickSimilar={noop}
              rating={null}
              ratingNote={null}
              ratingBusy={false}
              onRate={noop}
            />
          ))}
        </div>

        {/* Add another dinner */}
        <button
          type="button"
          className="border-hairline text-muted-foreground mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed px-4 py-3.5 text-sm font-semibold"
        >
          <span className="bg-card flex h-9 w-9 items-center justify-center rounded-full shadow-sm">
            <ChefHat className="text-primary h-4 w-4" />
          </span>
          <span className="flex-1 text-left">Add another dinner</span>
          <span className="bg-primary flex h-7 w-7 items-center justify-center rounded-full text-white">
            <Plus className="h-4 w-4" />
          </span>
        </button>

        {/* You might also like */}
        <section className="border-hairline mt-10 border-t pt-8">
          <h2
            className="text-lg font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            You might also like
          </h2>
          <p className="text-muted-foreground mt-0.5 mb-5 text-[0.85rem]">
            Picked from how your household eats
          </p>
          <div className="space-y-6">
            {SUGGESTIONS.map((s) => (
              <div key={s.title} className="flex items-center gap-4">
                <img
                  src={s.img}
                  alt=""
                  aria-hidden
                  className="souso-sticker h-20 w-20 shrink-0 object-contain"
                  style={{ transform: 'rotate(-3deg)' }}
                />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[1rem] font-bold">{s.title}</h3>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[0.78rem]">
                    {s.ingredients}
                  </p>
                </div>
                <button
                  type="button"
                  className="border-primary text-primary inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            ))}
          </div>
        </section>

        <div aria-hidden className="h-24" />
      </div>

      <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
        <Button size="pill" className="shadow-lg">
          <ShoppingBasket className="h-5 w-5" aria-hidden />
          Make my cart &middot; &euro;36,40
        </Button>
      </div>
    </DesignShell>
  )
}
