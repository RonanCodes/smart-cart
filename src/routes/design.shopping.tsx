import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import {
  Check,
  Sparkles,
  Leaf,
  ShoppingCart,
  ShoppingBasket,
} from 'lucide-react'
import { DesignShell } from '#/components/design/design-shell'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'
import { cn } from '#/lib/utils'

/**
 * DESIGN PREVIEW (throwaway) — /design/shopping. The Souso basket against dummy
 * data: store pill, airy hairline groups with die-cut product stickers, prices,
 * checkboxes, a running total + a floating order button. Delete before shipping.
 */

interface Item {
  name: string
  qty: string
  price?: string
  bonus?: boolean
  sticker: string
  checked: boolean
}

const GROUPS: Array<{ title: string; items: Array<Item> }> = [
  {
    title: 'Produce',
    items: [
      {
        name: 'Vine tomatoes',
        qty: '500 g',
        price: '€1,29',
        sticker: 'tomato',
        checked: true,
      },
      {
        name: 'Red onion',
        qty: '3 pcs',
        price: '€0,89',
        sticker: 'onion',
        checked: true,
      },
      {
        name: 'Garlic',
        qty: '1 bulb',
        price: '€0,55',
        sticker: 'garlic',
        checked: false,
      },
      {
        name: 'Lemon',
        qty: '3 pcs',
        bonus: true,
        sticker: 'lemon',
        checked: false,
      },
    ],
  },
  {
    title: 'Dairy & cheese',
    items: [
      {
        name: 'Feta',
        qty: '200 g',
        price: '€2,49',
        sticker: 'cheese',
        checked: true,
      },
      {
        name: 'Semi-skimmed milk',
        qty: '1 L',
        price: '€1,15',
        sticker: 'dairy',
        checked: false,
      },
    ],
  },
]

const STORES = [
  { id: 'ah', name: 'Albert Heijn', price: '€34,20' },
  { id: 'jumbo', name: 'Jumbo', price: '€32,80' },
  { id: 'picnic', name: 'Picnic', price: '€35,10' },
] as const

export const Route = createFileRoute('/design/shopping')({
  beforeLoad: requireAdminBeforeLoad,
  validateSearch: (s: Record<string, unknown>): { state?: string } =>
    typeof s.state === 'string' ? { state: s.state } : {},
  component: DesignShopping,
})

function DesignShopping() {
  const navigate = useNavigate()
  const { state } = Route.useSearch()
  const [storeId, setStoreId] = useState<(typeof STORES)[number]['id']>('ah')
  const store = STORES.find((s) => s.id === storeId) ?? STORES[0]
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    GROUPS.forEach((g) => g.items.forEach((i) => (m[i.name] = i.checked)))
    return m
  })

  if (state === 'loading') {
    return (
      <DesignShell>
        <div className="px-5 pt-6">
          <div className="bg-secondary/70 h-8 w-32 animate-pulse rounded-full" />
          <div className="bg-secondary/70 mt-4 h-8 w-36 animate-pulse rounded-full" />
          <div className="mt-8 space-y-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5">
                <div className="bg-secondary/70 h-12 w-12 shrink-0 animate-pulse rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="bg-secondary/70 h-4 w-32 animate-pulse rounded-full" />
                  <div className="bg-secondary/70 h-3 w-16 animate-pulse rounded-full" />
                </div>
                <div className="bg-secondary/70 h-4 w-10 animate-pulse rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </DesignShell>
    )
  }

  if (state === 'empty') {
    return (
      <DesignShell>
        <div className="flex flex-col items-center px-8 pt-20 text-center">
          <div className="bg-secondary text-primary flex h-16 w-16 items-center justify-center rounded-full">
            <ShoppingBasket className="h-7 w-7" />
          </div>
          <h2
            className="mt-5 text-2xl font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            Your cart is empty
          </h2>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">
            Plan your week and Souso merges every recipe into one ready-to-order
            cart.
          </p>
          <Button
            size="pill"
            className="mt-6 max-w-xs"
            onClick={() => navigate({ to: '/design/week' })}
          >
            Plan my week
          </Button>
        </div>
      </DesignShell>
    )
  }

  return (
    <DesignShell>
      <div className="px-5 pt-4">
        <h1
          className="text-[2rem] font-bold"
          style={{ letterSpacing: '-0.035em' }}
        >
          Cart
        </h1>

        {/* Store switch — compare the same basket across stores. */}
        <div className="border-border bg-card mt-3 grid grid-cols-3 gap-1 rounded-2xl border p-1 shadow-sm">
          {STORES.map((s) => {
            const on = s.id === storeId
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStoreId(s.id)}
                aria-pressed={on}
                className={cn(
                  'flex flex-col items-center rounded-xl px-2 py-1.5 transition active:scale-95',
                  on ? 'bg-primary text-primary-foreground' : 'text-foreground',
                )}
              >
                <span className="text-[0.78rem] font-bold">{s.name}</span>
                <span
                  className={cn(
                    'text-[0.72rem] font-semibold',
                    on ? 'text-primary-foreground/85' : 'text-muted-foreground',
                  )}
                >
                  {s.price}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
          <Sparkles className="text-primary h-3.5 w-3.5" />
          Merged automatically from 5 recipes
        </p>

        <p className="text-primary/90 mt-2 flex items-center gap-1.5 text-xs font-medium">
          <Leaf className="h-3.5 w-3.5" />6 ingredients reused, nothing left
          over
        </p>
      </div>

      <div className="px-5 pt-4">
        {GROUPS.map((group) => (
          <section key={group.title} className="mb-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-muted-foreground text-[0.7rem] font-bold tracking-[0.16em] uppercase">
                {group.title}
              </h2>
              {group.title === 'Dairy & cheese' && (
                <StickyNote tilt={-4} className="text-[0.95rem]">
                  don&rsquo;t forget the feta!
                </StickyNote>
              )}
            </div>
            <div>
              {group.items.map((item) => {
                const on = checks[item.name]
                return (
                  <div
                    key={item.name}
                    className="border-hairline flex items-center gap-3.5 border-b py-3 last:border-b-0"
                  >
                    <div className="bg-secondary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                      <img
                        src={`/stickers/ingredients/${item.sticker}.png`}
                        alt=""
                        aria-hidden
                        className="souso-sticker h-9 w-9 object-contain"
                        style={{ transform: 'rotate(-3deg)' }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-[0.95rem] font-semibold',
                          on && 'text-muted-foreground',
                        )}
                      >
                        {item.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {item.qty}
                      </p>
                    </div>
                    {item.bonus ? (
                      <span className="rounded-md border border-[#f1ce8e] bg-[#fbe6c2] px-1.5 py-0.5 text-[0.62rem] font-extrabold tracking-wide text-[#7a4d10] uppercase">
                        Bonus
                      </span>
                    ) : (
                      <span className="text-sm font-bold">{item.price}</span>
                    )}
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setChecks((c) => ({ ...c, [item.name]: !c[item.name] }))
                      }
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition active:scale-90',
                        on
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-card',
                      )}
                    >
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        <div aria-hidden className="h-28" />
      </div>

      {/* Floating total + order action above the tab bar. */}
      <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <span className="text-muted-foreground text-xs font-semibold">
            Total &middot; 23 products
          </span>
          <span className="text-lg font-extrabold">{store.price}</span>
        </div>
        <Button size="pill" className="shadow-lg">
          <ShoppingCart className="h-5 w-5" aria-hidden />
          Order at {store.name}
        </Button>
      </div>
    </DesignShell>
  )
}
