import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'

/**
 * StoreStep: the final 'Where do you shop?' screen of the Jow-style onboarding
 * (parent PRD #104, slice #109). Replaces Jow's long grocer list with exactly
 * three Dutch stores: Albert Heijn, Jumbo, and Picnic. The picked store sets
 * `draft.store` (slug 'ah' | 'jumbo'); the planner uses it to build a
 * ready-to-order basket against that retailer.
 *
 * Picnic is the in-joke: tapping it does NOT select a store. Instead it shows a
 * cheeky inline message ('Coming soon, if we can convince the CTO') because the
 * Picnic CTO is a megathon judge. Picnic stays visually 'coming soon' and never
 * writes to the draft.
 *
 * Persistence is wired separately (#110); this step only patches the in-flight
 * draft. Mobile first at 390px: full-width tappable rows with brand initials and
 * brand colours (no exact logos needed).
 */

interface StoreOption {
  /** Slug stored in draft.store. Picnic has no slug because it never selects. */
  slug: string | null
  name: string
  /** Brand initials shown in the colour chip in lieu of a logo. */
  initials: string
  /** Tailwind classes for the brand chip background + text. */
  chipClassName: string
  /** Selectable stores write to the draft; Picnic is the coming-soon joke. */
  comingSoon?: boolean
}

const STORES: ReadonlyArray<StoreOption> = [
  {
    slug: 'ah',
    name: 'Albert Heijn',
    initials: 'AH',
    chipClassName: 'bg-[#00ade6] text-white',
  },
  {
    slug: 'jumbo',
    name: 'Jumbo',
    initials: 'J',
    chipClassName: 'bg-[#eab90c] text-black',
  },
  {
    slug: null,
    name: 'Picnic',
    initials: 'P',
    chipClassName: 'bg-[#e1141d] text-white',
    comingSoon: true,
  },
]

const PICNIC_JOKE = 'Coming soon, if we can convince the CTO'

export function StoreStep() {
  const { draft, patch } = useOnboardingForm()
  const [showPicnicJoke, setShowPicnicJoke] = React.useState(false)

  function pick(option: StoreOption) {
    if (option.comingSoon) {
      // Picnic is the in-joke: flash the message, never touch the draft.
      setShowPicnicJoke(true)
      return
    }
    setShowPicnicJoke(false)
    patch({ store: option.slug })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="store-step">
      <div
        role="radiogroup"
        aria-label="Preferred store"
        className="flex flex-col gap-3"
      >
        {STORES.map((option) => {
          const isSelected = option.slug !== null && draft.store === option.slug
          return (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => pick(option)}
              className={cn(
                'flex items-center gap-4 rounded-[var(--radius-ios)] border p-4 text-left transition active:scale-[0.98]',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
                option.comingSoon && 'opacity-70',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold',
                  option.chipClassName,
                )}
              >
                {option.initials}
              </span>
              <span className="flex flex-1 flex-col">
                <span className="text-foreground font-semibold">
                  {option.name}
                </span>
                {option.comingSoon ? (
                  <span className="text-muted-foreground text-xs">
                    Coming soon
                  </span>
                ) : null}
              </span>
              {isSelected ? (
                <Check aria-hidden className="text-primary h-6 w-6 shrink-0" />
              ) : null}
            </button>
          )
        })}
      </div>

      {showPicnicJoke ? (
        <p
          role="status"
          className="bg-card text-foreground rounded-[var(--radius-ios)] border border-dashed border-[#e1141d] p-4 text-sm"
        >
          <span aria-hidden className="mr-1">
            🛒
          </span>
          {PICNIC_JOKE}
        </p>
      ) : null}
    </div>
  )
}
