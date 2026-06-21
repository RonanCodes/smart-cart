import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Beaker } from 'lucide-react'
import { setGlobalDataMode, setHouseholdDataMode } from '#/lib/data-mode-server'
import type { DataMode, DataModeSettings } from '#/lib/data-mode-server'
import type { AdminUserRow } from '#/lib/admin-server'
import { cn } from '#/lib/utils'

/**
 * Data-mode console: a GLOBAL real/demo default plus per-household overrides.
 * The /week + /shopping loaders read the effective mode (override ?? global ??
 * real) to decide whether to render the household's real DB data or the canned
 * DEMO data (a fixed week + cart) for the pitch. Admin-gated upstream by the
 * /admin guard; every write is re-validated + re-gated server-side.
 */
export function DataModePanel({
  settings,
  users,
}: {
  settings: DataModeSettings
  users: Array<AdminUserRow>
}) {
  const queryClient = useQueryClient()
  // Optimistic local copy of the global default so the segmented control reacts
  // instantly; re-synced from the server read on refresh.
  const [global, setGlobal] = useState<DataMode>(settings.global)
  const [savingGlobal, setSavingGlobal] = useState(false)

  // householdId -> its current override ('real'|'demo') or null (= inherit).
  const overrideMap = useMemo(() => {
    const m = new Map<string, DataMode>()
    for (const o of settings.overrides) m.set(o.householdId, o.mode)
    return m
  }, [settings.overrides])
  const [overrides, setOverrides] = useState<Map<string, DataMode | null>>(
    () => new Map(overrideMap),
  )
  const [savingHousehold, setSavingHousehold] = useState<string | null>(null)

  // Only households can carry an override; people who never onboarded have no id.
  const households = users.filter(
    (u): u is AdminUserRow & { householdId: string } => u.householdId !== null,
  )

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'data-mode'] })
  }

  async function changeGlobal(mode: DataMode) {
    if (savingGlobal || mode === global) return
    setSavingGlobal(true)
    const prev = global
    setGlobal(mode) // optimistic
    try {
      await setGlobalDataMode({ data: { mode } })
      await refresh()
    } catch {
      setGlobal(prev) // roll back on failure
    } finally {
      setSavingGlobal(false)
    }
  }

  async function changeHousehold(householdId: string, next: DataMode | null) {
    if (savingHousehold) return
    const current = overrides.get(householdId) ?? null
    if (next === current) return
    setSavingHousehold(householdId)
    const prevMap = new Map(overrides)
    setOverrides((m) => {
      const copy = new Map(m)
      if (next === null) copy.delete(householdId)
      else copy.set(householdId, next)
      return copy
    })
    try {
      await setHouseholdDataMode({ data: { householdId, mode: next } })
      await refresh()
    } catch {
      setOverrides(prevMap) // roll back on failure
    } finally {
      setSavingHousehold(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Global default */}
      <section className="border-border bg-card space-y-3 rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <Beaker
            className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <div>
            <h2 className="text-lg font-semibold">Data mode</h2>
            <p className="text-muted-foreground text-sm">
              The default for every household. Demo makes the Week + Cart
              screens render fixed canned data (a polished example week and
              basket) instead of the household&apos;s real DB data, for a fast,
              deterministic pitch.
            </p>
          </div>
        </div>

        <ModeSegmented
          value={global}
          onChange={(m) => void changeGlobal(m)}
          disabled={savingGlobal}
          ariaLabel="Global data mode"
        />
      </section>

      {/* Per-household overrides */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Per-household overrides</h2>
          <p className="text-muted-foreground text-sm">
            Inherit follows the global default. Set a household to Real or Demo
            to override it just for them. The effective mode is what their Week
            + Cart screens render.
          </p>
        </div>

        <div className="space-y-2">
          {households.map((u) => {
            const override = overrides.get(u.householdId) ?? null
            const effective: DataMode = override ?? global
            const selection: 'inherit' | DataMode = override ?? 'inherit'
            return (
              <div
                key={u.householdId}
                className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{u.email}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    Effective:{' '}
                    <span className="text-foreground font-semibold">
                      {effective === 'demo' ? 'Demo' : 'Real'}
                    </span>
                    {override === null && ' (inherited)'}
                  </div>
                </div>
                <ThreeWaySegmented
                  value={selection}
                  onChange={(v) =>
                    void changeHousehold(
                      u.householdId,
                      v === 'inherit' ? null : v,
                    )
                  }
                  disabled={savingHousehold === u.householdId}
                  ariaLabel={`Data mode for ${u.email}`}
                />
              </div>
            )
          })}
          {households.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No onboarded households yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

/** A two-segment Real/Demo control for the global default. */
function ModeSegmented({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: DataMode
  onChange: (m: DataMode) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-secondary inline-flex w-full max-w-xs gap-1 rounded-xl p-1"
    >
      <SegmentButton
        selected={value === 'real'}
        onClick={() => onChange('real')}
        disabled={disabled}
        label="Real"
      />
      <SegmentButton
        selected={value === 'demo'}
        onClick={() => onChange('demo')}
        disabled={disabled}
        label="Demo"
      />
    </div>
  )
}

/** A three-segment Inherit/Real/Demo control for a single household. */
function ThreeWaySegmented({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: 'inherit' | DataMode
  onChange: (v: 'inherit' | DataMode) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-secondary inline-flex shrink-0 gap-1 rounded-xl p-1"
    >
      <SegmentButton
        selected={value === 'inherit'}
        onClick={() => onChange('inherit')}
        disabled={disabled}
        label="Inherit"
      />
      <SegmentButton
        selected={value === 'real'}
        onClick={() => onChange('real')}
        disabled={disabled}
        label="Real"
      />
      <SegmentButton
        selected={value === 'demo'}
        onClick={() => onChange('demo')}
        disabled={disabled}
        label="Demo"
      />
    </div>
  )
}

/** One pill in a segmented control: raised card when selected. */
function SegmentButton({
  selected,
  onClick,
  disabled,
  label,
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-9 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium whitespace-nowrap transition disabled:opacity-50',
        selected
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
