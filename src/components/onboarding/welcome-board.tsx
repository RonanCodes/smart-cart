import { Button } from '#/components/ui/button'

/**
 * WelcomeBoard — the Souso welcome screen that opens onboarding. A scattered
 * "board" of die-cut dish stickers fading up into the menu (the Souso mark, a
 * line, and the start / sign-in actions). Fills its parent (the onboarding
 * route's safe-area frame). Replaces the older value-slide carousel.
 */

/** Dish stickers as a 3-column offset grid (brick / crisscross): the middle
 * column is nudged down so rows interlock like Julienne's. A 16px gap keeps every
 * dish clear of the others — columns never overlap, so the offset is always safe. */
const COLUMNS: Array<Array<{ img: string; rot: number }>> = [
  [
    { img: 'chicken-orzo', rot: -5 },
    { img: 'chicken-skewers', rot: 5 },
    { img: 'apple-crumble', rot: -4 },
  ],
  [
    { img: 'gnocchi-romesco', rot: 6 },
    { img: 'orecchiette', rot: -5 },
    { img: 'seed-crackers', rot: 4 },
  ],
  [
    { img: 'veggie-lasagne', rot: -3 },
    { img: 'roast-veg', rot: 5 },
    { img: 'one-pan-pasta', rot: -6 },
  ],
]

export function WelcomeBoard({
  onGetStarted,
  onSignIn,
}: {
  onGetStarted: () => void
  onSignIn?: () => void
}) {
  return (
    <div
      data-testid="onboarding-welcome"
      className="relative flex flex-1 flex-col overflow-hidden"
    >
      {/* The sticker board — a 3-column offset grid. */}
      <div
        className="absolute inset-x-0 top-0 grid grid-cols-3 gap-4 px-4 pt-8"
        aria-hidden
      >
        {COLUMNS.map((col, ci) => (
          <div
            key={ci}
            className="flex flex-col gap-4"
            style={{ marginTop: ci === 1 ? '2.4rem' : 0 }}
          >
            {col.map((s) => (
              <img
                key={s.img}
                src={`/stickers/recipes/${s.img}.png`}
                alt=""
                className="souso-sticker w-full object-contain"
                style={{ transform: `rotate(${s.rot}deg)` }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Cream veil so the board fades up into the menu. */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            'linear-gradient(to top, #f5f1e7 30%, rgba(245,241,231,0.65) 50%, rgba(245,241,231,0) 72%)',
        }}
      />

      {/* Menu over the board. */}
      <div className="relative mt-auto flex flex-col items-center px-7 pb-16 text-center">
        <img src="/souso-mark.svg" alt="Souso" className="h-14 w-auto" />
        <h1
          className="mt-4 text-[2.1rem] leading-[1.04] font-bold"
          style={{ letterSpacing: '-0.03em' }}
        >
          Groceries, sorted.
        </h1>
        <p className="text-muted-foreground mt-2.5 max-w-[20rem] text-[0.95rem]">
          Tell Souso how your household eats once. Every week of dinners just
          works, basket and all.
        </p>
        <Button size="pill" className="mt-7" onClick={onGetStarted}>
          Get started
        </Button>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="text-muted-foreground mt-4 text-sm font-medium"
          >
            I have an account
          </button>
        )}
      </div>
    </div>
  )
}
