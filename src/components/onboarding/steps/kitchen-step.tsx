import { Flame, Microwave, CookingPot, Blend, Soup, Wind } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'

/**
 * KitchenStep — the 'Your kitchen' screen of the Jow-style onboarding (parent PRD
 * #104, slice #108). A multi-select icon grid of the appliances the household
 * owns. Recipes that need an appliance the user lacks get down-ranked or filtered
 * by the planner, so the picks here gate recipe feasibility.
 *
 * Reads + writes `draft.equipment` (a string array of labels) via
 * useOnboardingForm. Labels are stored verbatim; the planner matches recipe
 * appliance requirements against this list.
 *
 * Mobile first at 390px: a two-column tap grid of large, thumb-friendly targets,
 * matching the DietStep grid so the flow feels consistent screen to screen.
 */

interface KitchenOption {
  /** The label stored in draft.equipment verbatim. */
  label: string
  icon: LucideIcon
}

const OPTIONS: ReadonlyArray<KitchenOption> = [
  { label: 'Oven', icon: Flame },
  { label: 'Microwave', icon: Microwave },
  { label: 'Stovetop', icon: CookingPot },
  { label: 'Blender', icon: Blend },
  { label: 'Multi cooker', icon: Soup },
  { label: 'Air fryer', icon: Wind },
]

export function KitchenStep() {
  const { draft, patch } = useOnboardingForm()
  const selected = draft.equipment

  function toggle(label: string) {
    if (selected.includes(label)) {
      patch({ equipment: selected.filter((e) => e !== label) })
    } else {
      patch({ equipment: [...selected, label] })
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="kitchen-step">
      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label="Kitchen appliances"
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
    </div>
  )
}
