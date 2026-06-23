import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import { STORE_OPTIONS } from '#/lib/store-pref-server'
import type { StoreOption } from '#/lib/store-pref-server'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'
import { useOnboardingForm } from '../form-state'

/**
 * StoreStep: the final 'Where do you shop?' screen of the Jow-style onboarding
 * (parent PRD #104, slice #109). Replaces Jow's long grocer list with exactly
 * three Dutch stores: Albert Heijn, Jumbo, and Picnic. The picked store sets
 * `draft.store` (slug 'ah' | 'jumbo' | 'picnic'); the planner uses it to build a
 * ready-to-order basket against that retailer.
 *
 * Albert Heijn + Picnic are selectable; Jumbo is parked as a disabled "Coming
 * soon" row until its pricing + cart are tested (still shown so we can re-enable
 * it later). The list comes from the shared STORE_OPTIONS catalogue so
 * onboarding and the Profile store sheet can't drift. Stores with a brand logo
 * (Picnic) render it; the rest keep their brand-colour initials chip.
 *
 * Persistence is wired separately (#110); this step only patches the in-flight
 * draft. Mobile first at 390px: full-width tappable rows.
 */
export function StoreStep() {
  const { draft, patch } = useOnboardingForm()

  function pick(option: StoreOption) {
    if (option.comingSoon) return
    patch({ store: option.slug })
    // Which store the household picked during onboarding (ah | jumbo | picnic).
    track(FUNNEL_EVENTS.storeSelected, {
      store: option.slug,
      source: 'onboarding',
    })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="store-step">
      <div
        role="radiogroup"
        aria-label="Preferred store"
        className="flex flex-col gap-3"
      >
        {STORE_OPTIONS.map((option) => {
          const comingSoon = option.comingSoon === true
          const isSelected = draft.store === option.slug && !comingSoon
          return (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={comingSoon}
              disabled={comingSoon}
              onClick={() => pick(option)}
              className={cn(
                'flex items-center gap-4 rounded-[var(--radius-ios)] border p-4 text-left transition active:scale-[0.98]',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
                comingSoon && 'cursor-not-allowed opacity-50 active:scale-100',
              )}
            >
              {option.iconSrc ? (
                <img
                  src={option.iconSrc}
                  alt=""
                  aria-hidden
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold',
                    option.chipClassName,
                  )}
                >
                  {option.initials}
                </span>
              )}
              <span className="flex flex-1 flex-col">
                <span className="text-foreground font-semibold">
                  {option.name}
                </span>
              </span>
              {comingSoon ? (
                <span className="bg-secondary text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-[0.7rem] font-semibold">
                  Coming soon
                </span>
              ) : isSelected ? (
                <Check aria-hidden className="text-primary h-6 w-6 shrink-0" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
