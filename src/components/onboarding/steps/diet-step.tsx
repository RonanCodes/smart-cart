import { Milk, Wheat, Ham, Leaf, Salad, Fish, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'

/**
 * DietStep — the 'Your tastes' screen of the Jow-style onboarding (parent PRD
 * #104, slice #107). A multi-select icon grid of dietary restrictions. Each
 * picked restriction becomes a HARD filter in the planner (the recommender
 * already hard-filters on diet), so these are honoured every week, not weighted.
 *
 * Reads + writes `draft.diet` (a string array of labels) via useOnboardingForm.
 * Two info notes from the reference screenshot set expectations: restrictions
 * are always honoured, and they can be changed later.
 *
 * Vegan/Vegetarian/Pescatarian are kept simple multi-selects (no exclusivity
 * enforcement) — the planner treats the strictest one as binding. Mobile first
 * at 390px: a two-column tap grid of large targets.
 */

interface DietOption {
  /** The label stored in draft.diet verbatim. */
  label: string
  icon: LucideIcon
}

const OPTIONS: ReadonlyArray<DietOption> = [
  { label: 'Dairy free', icon: Milk },
  { label: 'Gluten free', icon: Wheat },
  { label: 'Porkless', icon: Ham },
  { label: 'Vegan', icon: Leaf },
  { label: 'Vegetarian', icon: Salad },
  { label: 'Pescatarian', icon: Fish },
]

export function DietStep() {
  const { draft, patch } = useOnboardingForm()
  const selected = draft.diet

  function toggle(label: string) {
    if (selected.includes(label)) {
      patch({ diet: selected.filter((d) => d !== label) })
    } else {
      patch({ diet: [...selected, label] })
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="diet-step">
      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label="Dietary restrictions"
      >
        {OPTIONS.map(({ label, icon: Icon }) => {
          const isOn = selected.includes(label)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(label)}
              className={cn(
                'flex h-24 flex-col items-center justify-center gap-2 rounded-[var(--radius-ios)] border text-sm font-medium transition active:scale-95',
                isOn
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground',
              )}
            >
              <Icon
                aria-hidden
                className={cn('h-7 w-7', isOn ? '' : 'text-primary')}
              />
              {label}
            </button>
          )
        })}
      </div>

      <div className="text-muted-foreground space-y-2 text-sm">
        <p className="flex items-start gap-2">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          Restrictions are always honoured — we never suggest a recipe that
          breaks one.
        </p>
        <p className="flex items-start gap-2">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          You can change these any time from your profile.
        </p>
      </div>
    </div>
  )
}
