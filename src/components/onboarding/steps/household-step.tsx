import { Minus, Plus, User, Baby } from 'lucide-react'
import { useOnboardingForm } from '../form-state'

/**
 * HouseholdStep — the first stepped screen of the Jow-style onboarding (slice
 * #106). Three counters that size the week's portions:
 *   - Adults: a stepper, floored at 1 (a household has at least one cook).
 *   - Children: a stepper floored at 0; each child gets an age input so the
 *     recommender can size child portions. Adding/removing a child grows or
 *     trims the `childrenAges` array in lockstep with the count.
 *   - Pets: cat + dog steppers, floored at 0 (captured for leftover sizing).
 *
 * Everything writes straight to the shared draft through `patch()`; there is no
 * local state, so the flow's back/forward navigation always reflects the truth.
 *
 * iOS-native and tap-first: 44px round steppers, big numerals, mobile first at
 * 390px. No `canAdvance` gate — a household is always valid (adults floors at 1).
 */

const ADULT_FLOOR = 1
const CHILD_FLOOR = 0
/** A sane default age for a freshly added child, editable inline. */
const DEFAULT_CHILD_AGE = 6
const MAX_CHILD_AGE = 17

function Stepper({
  label,
  icon,
  value,
  min,
  onChange,
}: {
  label: string
  icon: React.ReactNode
  value: number
  min: number
  onChange: (next: number) => void
}) {
  return (
    <div className="border-border bg-card flex items-center justify-between rounded-[var(--radius-ios)] border p-4">
      <div className="flex items-center gap-3">
        <span
          className="bg-secondary text-primary flex h-10 w-10 items-center justify-center rounded-full"
          aria-hidden
        >
          {icon}
        </span>
        <span className="text-[1.05rem] font-semibold">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Remove one ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="border-border flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-30"
        >
          <Minus className="h-5 w-5" />
        </button>
        <span
          className="w-7 text-center text-xl font-bold tabular-nums"
          aria-live="polite"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Add one ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          className="border-primary text-primary flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function HouseholdStep() {
  const { draft, patch } = useOnboardingForm()
  const { adults, children, childrenAges } = draft

  function setAdults(next: number) {
    patch({ adults: Math.max(ADULT_FLOOR, next) })
  }

  function setChildren(next: number) {
    const count = Math.max(CHILD_FLOOR, next)
    // Keep childrenAges in lockstep: trim extras, seed new entries.
    const ages = Array.from({ length: count }, (_, i) =>
      i < childrenAges.length ? childrenAges[i]! : DEFAULT_CHILD_AGE,
    )
    patch({ children: count, childrenAges: ages })
  }

  function setChildAge(index: number, age: number) {
    const clamped = Math.max(0, Math.min(MAX_CHILD_AGE, age))
    const ages = childrenAges.map((a, i) => (i === index ? clamped : a))
    patch({ childrenAges: ages })
  }

  return (
    <div className="space-y-3" data-testid="household-step">
      <Stepper
        label="Adults"
        icon={<User className="h-5 w-5" />}
        value={adults}
        min={ADULT_FLOOR}
        onChange={setAdults}
      />

      <Stepper
        label="Children"
        icon={<Baby className="h-5 w-5" />}
        value={children}
        min={CHILD_FLOOR}
        onChange={setChildren}
      />

      {children > 0 && (
        <div
          className="border-border bg-card rounded-[var(--radius-ios)] border p-4"
          data-testid="children-ages"
        >
          <p className="text-muted-foreground mb-3 text-sm font-medium">
            How old is each child?
          </p>
          <div className="space-y-2.5">
            {childrenAges.map((age, i) => (
              // Index-keyed on purpose: children are positional and anonymous,
              // so a row's identity IS its position in the list.
              <label
                key={`child-${i}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-[0.95rem]">Child {i + 1}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_CHILD_AGE}
                    value={age}
                    aria-label={`Age of child ${i + 1}`}
                    onChange={(e) => setChildAge(i, Number(e.target.value))}
                    className="border-border bg-background h-11 w-16 rounded-xl border text-center text-base tabular-nums"
                  />
                  <span className="text-muted-foreground text-sm">yrs</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
