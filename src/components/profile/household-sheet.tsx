import * as React from 'react'
import { Minus, Plus, User, Baby } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { updateHouseholdSize } from '#/lib/onboarding-server'
import type { HouseholdSummary } from '#/lib/onboarding-server'

/**
 * HouseholdSheet — the Profile-tab inline editor for household size. This
 * REPLACED the old "tap Household -> full re-onboarding" path: that path sent the
 * user into the (now email-last) onboarding form, which starts blank, so a tester
 * read it as "it logged me out and I had to start all over again". It never
 * actually dropped the session; the blank form was a perceived reset. Editing
 * adults/children is a small, in-place edit, so it belongs in a sheet, not a flow.
 *
 * Two steppers (adults floored at 1, children floored at 0), pre-filled from the
 * current summary, with a Save that persists via updateHouseholdSize and hands the
 * refreshed summary back so the parent row updates in place. The session is never
 * touched and there is no navigation away.
 *
 * Mirrors the StoreSheet / SkipDaysSheet pattern in this folder (and reuses the
 * onboarding HouseholdStep stepper styling) for a consistent iOS sheet at 390px.
 */

const ADULT_FLOOR = 1
const CHILD_FLOOR = 0

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

export function HouseholdSheet({
  open,
  onOpenChange,
  summary,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current household summary, used to pre-fill the steppers. */
  summary: HouseholdSummary | null
  /** Fired with the refreshed summary after a successful save. */
  onSaved: (next: HouseholdSummary) => void
}) {
  const [adults, setAdults] = React.useState(summary?.adults ?? 1)
  const [children, setChildren] = React.useState(summary?.children ?? 0)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState(false)

  // Re-seed from the live summary each time the sheet opens, so the steppers
  // always reflect the saved value (e.g. after a previous edit).
  React.useEffect(() => {
    if (open) {
      setAdults(summary?.adults ?? 1)
      setChildren(summary?.children ?? 0)
      setError(false)
    }
  }, [open, summary])

  async function save() {
    setError(false)
    setSaving(true)
    try {
      const next = await updateHouseholdSize({ data: { adults, children } })
      onSaved(next)
      onOpenChange(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Household">
      <div className="flex flex-col gap-5 pt-2 pb-2">
        <p className="text-muted-foreground text-sm leading-relaxed">
          How many people does Souso cook for? This sizes the portions in your
          next week.
        </p>

        <div className="flex flex-col gap-3">
          <Stepper
            label="Adults"
            icon={<User className="h-5 w-5" />}
            value={adults}
            min={ADULT_FLOOR}
            onChange={(next) => setAdults(Math.max(ADULT_FLOOR, next))}
          />
          <Stepper
            label="Children"
            icon={<Baby className="h-5 w-5" />}
            value={children}
            min={CHILD_FLOOR}
            onChange={(next) => setChildren(Math.max(CHILD_FLOOR, next))}
          />
        </div>

        {error && (
          <p role="status" className="text-muted-foreground text-xs">
            Couldn&apos;t save that just now. Try again.
          </p>
        )}

        <Button
          size="pill"
          className="w-full"
          disabled={saving}
          onClick={() => void save()}
          data-testid="household-save"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Sheet>
  )
}
