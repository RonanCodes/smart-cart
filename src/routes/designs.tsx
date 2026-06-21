import { createFileRoute, Link } from '@tanstack/react-router'
import { SafeArea } from '#/components/ui/safe-area'

/**
 * PUBLIC index of TJ's Souso design prototype screens (no login). One place to
 * click through the whole /design/* prototype for review. Noindexed so it stays
 * out of search while being shareable for a review. Throwaway alongside the
 * design.* routes; delete with them before launch.
 */

const SCREENS: Array<{
  to: string
  label: string
  blurb: string
  img: string
}> = [
  {
    to: '/design/landing',
    label: 'Landing',
    blurb: 'The waitlist / marketing entry',
    img: '/stickers/recipes/apple-crumble.png',
  },
  {
    to: '/design/onboarding',
    label: 'Onboarding',
    blurb: 'Welcome board + the stepped setup',
    img: '/stickers/recipes/seed-crackers.png',
  },
  {
    to: '/design/week',
    label: 'Week',
    blurb: 'The dinner plan, swipe to swap',
    img: '/stickers/recipes/chicken-orzo.png',
  },
  {
    to: '/design/recipe',
    label: 'Recipe',
    blurb: 'A dish, ingredients + steps',
    img: '/stickers/recipes/gnocchi-romesco.png',
  },
  {
    to: '/design/discover',
    label: 'Search',
    blurb: 'Live search + browse rows',
    img: '/stickers/recipes/orecchiette.png',
  },
  {
    to: '/design/shopping',
    label: 'Cart',
    blurb: 'The merged basket + store switch',
    img: '/stickers/recipes/roast-veg.png',
  },
  {
    to: '/design/settings',
    label: 'Settings',
    blurb: 'Profile + preferences',
    img: '/stickers/recipes/veggie-lasagne.png',
  },
]

export const Route = createFileRoute('/designs')({
  head: () => ({
    meta: [
      { title: 'Souso design prototype' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: DesignsIndex,
})

function DesignsIndex() {
  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background min-h-[100dvh]"
    >
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <header className="flex flex-col items-center text-center">
          <img src="/souso-mark.svg" alt="Souso" className="h-12 w-auto" />
          <h1
            className="mt-4 text-[2rem] leading-tight font-bold"
            style={{ letterSpacing: '-0.03em' }}
          >
            Design prototype
          </h1>
          <p className="text-muted-foreground mt-2 max-w-md text-[0.95rem]">
            Click through TJ&rsquo;s Souso screens. No login, dummy data, the
            whole flow is wired so it&rsquo;s clickable end to end.
          </p>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SCREENS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="border-border bg-card flex items-center gap-4 rounded-2xl border p-4 shadow-sm transition active:scale-[0.99]"
            >
              <img
                src={s.img}
                alt=""
                aria-hidden
                className="souso-sticker h-16 w-16 shrink-0 object-contain"
                style={{ transform: 'rotate(-4deg)' }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-bold">{s.label}</p>
                <p className="text-muted-foreground text-[0.82rem]">
                  {s.blurb}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-muted-foreground/70 mt-10 text-center text-xs">
          Prototype with dummy data. The real app lives behind sign-in.
        </p>
      </div>
    </SafeArea>
  )
}
