import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { DAY_LABELS } from '#/lib/onboarding-rhythm'
import { updateHouseholdProfile } from '#/lib/profile-edit-server'
import type {
  EditableProfile,
  InferredSkipDays,
} from '#/lib/profile-edit-server'

/**
 * SkipDaysSheet — the "accept auto-inferred OR override" data point
 * (#data-points). Souso infers which weekdays a household skips dinner from
 * their past plans; this sheet shows that inference and lets the household:
 *  (a) ACCEPT it ("Use this") — saves it as their manual override, OR
 *  (b) manually TOGGLE which weekdays they skip (the 7-day row), OR
 *  (c) CLEAR it — back to letting Souso auto-infer.
 *
 * Manual wins over inference in generation (resolveSkipDays in planner). The
 * sheet writes only `skipDays` on the profile via updateHouseholdProfile; null
 * means "auto-infer", an array (incl. empty) means "use exactly these".
 *
 * Mobile-first at 390px: iOS sheet styling, a Mon–Sun toggle row, calm copy.
 */

/** Human phrasing for a small inferred set ("Fridays", "Wednesdays + Sundays"). */
function describeDays(days: ReadonlyArray<number>): string {
  const names = days.map((d) => `${DAY_LABELS[d]}days`)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function SkipDaysSheet({
  open,
  onOpenChange,
  inferred,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inferred: InferredSkipDays | null
  onSaved: (next: EditableProfile) => void
}) {
  // null = "auto-infer"; an array = explicit override (the manual toggles).
  const [selection, setSelection] = React.useState<Array<number> | null>(
    inferred?.manual ?? null,
  )
  const [saving, setSaving] = React.useState<'use' | 'manual' | 'clear' | null>(
    null,
  )
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setSelection(inferred?.manual ?? null)
      setError(false)
    }
  }, [open, inferred])

  const hasManual = inferred?.manual != null
  const hasInference = (inferred?.inferred.length ?? 0) > 0

  // The toggle row reflects the manual selection if set, else the inference as a
  // starting point so a tap-to-edit feels continuous with the suggestion.
  const activeDays = selection ?? inferred?.inferred ?? []

  function toggleDay(day: number) {
    const base = selection ?? inferred?.inferred ?? []
    const next = base.includes(day)
      ? base.filter((d) => d !== day)
      : [...base, day].sort((a, b) => a - b)
    setSelection(next)
  }

  async function persist(
    skipDays: Array<number> | null,
    which: 'use' | 'manual' | 'clear',
  ) {
    setError(false)
    setSaving(which)
    try {
      const next = await updateHouseholdProfile({
        data: { patch: { skipDays } },
      })
      onSaved(next)
      onOpenChange(false)
    } catch {
      setError(true)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Days you skip">
      <div className="flex flex-col gap-5 pt-2 pb-2">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Some weeks you eat out or skip cooking on the same days. Tell Souso
          which, and it leaves those days open instead of planning a dinner.
        </p>

        {hasInference && !hasManual && (
          <div className="bg-primary/5 border-primary/20 flex flex-col gap-3 rounded-[var(--radius-ios)] border p-4">
            <div className="flex items-start gap-2.5">
              <Sparkles
                aria-hidden
                className="text-primary mt-0.5 h-5 w-5 shrink-0"
              />
              <p className="text-sm">
                We noticed you usually skip{' '}
                <span className="font-semibold">
                  {describeDays(inferred!.inferred)}
                </span>
                . Want us to keep those open each week?
              </p>
            </div>
            <Button
              size="pill"
              className="w-full"
              disabled={saving !== null}
              onClick={() => void persist(inferred!.inferred, 'use')}
              data-testid="skip-days-use"
            >
              {saving === 'use' ? 'Saving…' : 'Use this'}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {hasManual ? 'Your skip days' : 'Set them yourself'}
          </h3>
          <div
            className="flex justify-between gap-1.5"
            role="group"
            aria-label="Weekdays you skip"
          >
            {DAY_LABELS.map((label, day) => {
              const isOn = activeDays.includes(day)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={isOn}
                  aria-label={`${label}: ${isOn ? 'skipped' : 'cooking'}`}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'flex h-12 flex-1 items-center justify-center rounded-xl border text-xs font-semibold transition active:scale-95',
                    isOn
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            Highlighted days are left open. Tap to change.
          </p>
        </div>

        {error && (
          <p role="status" className="text-muted-foreground text-xs">
            Couldn&apos;t save that just now. Try again.
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          <Button
            size="pill"
            className="w-full"
            disabled={saving !== null || selection === null}
            onClick={() =>
              void persist(selection ?? inferred?.inferred ?? [], 'manual')
            }
            data-testid="skip-days-save"
          >
            {saving === 'manual' ? 'Saving…' : 'Save my days'}
          </Button>
          {hasManual && (
            <Button
              size="pill"
              variant="outline"
              className="w-full"
              disabled={saving !== null}
              onClick={() => void persist(null, 'clear')}
              data-testid="skip-days-clear"
            >
              {saving === 'clear' ? 'Clearing…' : 'Let Souso decide'}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
