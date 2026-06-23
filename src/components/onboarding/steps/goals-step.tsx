import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import { GOAL_OPTIONS } from '#/lib/onboarding/goals'
import { useOnboardingForm } from '../form-state'

/**
 * GoalsStep — the 'Your goals' screen of the Jow-style onboarding (parent PRD
 * #104, slice #108). A checklist the user multi-selects. Unlike diet (a hard
 * filter), goals are a SOFT weighting: 'Eat less meat' nudges the week toward
 * fewer meat dinners, 'Pay less for my groceries' biases toward cheaper recipes,
 * and so on. The planner reads these as weights, never as hard cuts.
 *
 * Reads + writes `draft.goals` (a string array of labels) via useOnboardingForm.
 * Labels are stored verbatim. The screenshot puts the checkbox on the RIGHT of a
 * full-width row, so each option is one big tap target with an emoji lead, the
 * label, and a check that fills in when picked.
 *
 * Mobile first at 390px: full-width rows, generous height, thumb-friendly.
 */

export function GoalsStep() {
  const { draft, patch } = useOnboardingForm()
  const selected = draft.goals

  function toggle(label: string) {
    if (selected.includes(label)) {
      patch({ goals: selected.filter((g) => g !== label) })
    } else {
      patch({ goals: [...selected, label] })
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="goals-step">
      <p className="text-muted-foreground text-sm">
        Pick whatever matters to you. We gently weight your week toward it, no
        pressure to choose them all.
      </p>

      <div
        className="flex flex-col gap-2.5"
        role="group"
        aria-label="Your goals"
      >
        {GOAL_OPTIONS.map(({ label, icon: Icon }) => {
          const isOn = selected.includes(label)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(label)}
              className={cn(
                'flex h-16 w-full items-center gap-3 rounded-[var(--radius-ios)] border px-4 text-left text-sm font-medium transition active:scale-[0.98]',
                isOn
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border bg-card text-foreground',
              )}
            >
              <span
                aria-hidden
                className="bg-secondary text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              >
                <Icon className="h-[1.15rem] w-[1.15rem]" />
              </span>
              <span className="flex-1">{label}</span>
              <span
                aria-hidden
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition',
                  isOn
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background',
                )}
              >
                {isOn && <Check className="h-4 w-4" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
