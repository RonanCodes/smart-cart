import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CreditCard } from 'lucide-react'
import {
  setGlobalPaymentMode,
  setHouseholdPaymentMode,
} from '#/lib/payment-mode-server'
import type {
  PaymentMode,
  PaymentModeSettings,
} from '#/lib/payment-mode-server'
import type { AdminUserRow } from '#/lib/admin-server'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { cn } from '#/lib/utils'

/**
 * Mollie payment-mode console: a GLOBAL test/live default plus per-household
 * overrides. The tip flow reads the effective mode (override ?? global ?? test)
 * to pick which Mollie key creates the payment. 'Live' charges real money, so it
 * is always called out. Admin-gated upstream by the /admin guard; every write is
 * re-validated + re-gated server-side.
 */
export function PaymentsPanel({
  settings,
  users,
}: {
  settings: PaymentModeSettings
  users: Array<AdminUserRow>
}) {
  const queryClient = useQueryClient()
  // Optimistic local copy of the global default so the segmented control reacts
  // instantly; re-synced from the server read on refresh.
  const [global, setGlobal] = useState<PaymentMode>(settings.global)
  const [savingGlobal, setSavingGlobal] = useState(false)

  // householdId -> its current override ('test'|'live') or null (= inherit).
  const overrideMap = useMemo(() => {
    const m = new Map<string, PaymentMode>()
    for (const o of settings.overrides) m.set(o.householdId, o.mode)
    return m
  }, [settings.overrides])
  const [overrides, setOverrides] = useState<Map<string, PaymentMode | null>>(
    () => new Map(overrideMap),
  )
  const [savingHousehold, setSavingHousehold] = useState<string | null>(null)

  // Only households can carry an override; people who never onboarded have no id.
  const households = users.filter(
    (u): u is AdminUserRow & { householdId: string } => u.householdId !== null,
  )

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] })
  }

  async function changeGlobal(mode: PaymentMode) {
    if (savingGlobal || mode === global) return
    setSavingGlobal(true)
    const prev = global
    setGlobal(mode) // optimistic
    try {
      await setGlobalPaymentMode({ data: { mode } })
      await refresh()
    } catch {
      setGlobal(prev) // roll back on failure
    } finally {
      setSavingGlobal(false)
    }
  }

  async function changeHousehold(
    householdId: string,
    next: PaymentMode | null,
  ) {
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
      await setHouseholdPaymentMode({ data: { householdId, mode: next } })
      await refresh()
    } catch {
      setOverrides(prevMap) // roll back on failure
    } finally {
      setSavingHousehold(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <p className="text-primary text-[0.64rem] font-bold tracking-[0.16em] uppercase">
          Payments
        </p>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Mollie mode</h1>
        <p className="text-muted-foreground text-sm">
          Pick the test or live Mollie key tips run through, globally or per
          household.
        </p>
      </header>

      {/* Global default */}
      <Card ios>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-secondary text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <CreditCard className="h-5 w-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <CardTitle>Mollie mode</CardTitle>
              <CardDescription>
                The default for every household. Tips use the test key in Test
                mode and the live key in Live mode.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ModeSegmented
            value={global}
            onChange={(m) => void changeGlobal(m)}
            disabled={savingGlobal}
            ariaLabel="Global Mollie mode"
          />

          {global === 'live' && <LiveWarning scope="every household" />}
        </CardContent>
      </Card>

      {/* Per-household overrides */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Per-household overrides</h2>
          <p className="text-muted-foreground text-sm">
            Inherit follows the global default. Set a household to Test or Live
            to override it just for them. The effective mode is what their tips
            use.
          </p>
        </div>

        <div className="space-y-2">
          {households.map((u) => {
            const override = overrides.get(u.householdId) ?? null
            const effective: PaymentMode = override ?? global
            const selection: 'inherit' | PaymentMode = override ?? 'inherit'
            return (
              <Card
                key={u.householdId}
                ios
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{u.email}</div>
                  <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                    <span>Effective</span>
                    <Badge
                      variant={effective === 'live' ? 'accent' : 'outline'}
                      className={cn(
                        'px-2 py-0.5 text-[0.7rem]',
                        effective === 'live' &&
                          'bg-destructive text-destructive-foreground',
                      )}
                    >
                      {effective === 'live' ? 'Live' : 'Test'}
                    </Badge>
                    {override === null && (
                      <span className="text-muted-foreground">inherited</span>
                    )}
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
                  ariaLabel={`Mollie mode for ${u.email}`}
                />
              </Card>
            )
          })}
          {households.length === 0 && (
            <Card ios className="px-4 py-6">
              <p className="text-muted-foreground text-center text-sm">
                No onboarded households yet.
              </p>
            </Card>
          )}
        </div>
      </section>
    </div>
  )
}

/** A clear "Live charges real money" warning, shown whenever Live is selected. */
function LiveWarning({ scope }: { scope: string }) {
  return (
    <p
      role="alert"
      className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-[var(--radius-ios)] px-3 py-2.5 text-xs"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Live mode charges real money.</strong> Tips for {scope} go
        through the live Mollie key and bill the customer&apos;s card.
      </span>
    </p>
  )
}

/** A two-segment Test/Live control for the global default. */
function ModeSegmented({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: PaymentMode
  onChange: (m: PaymentMode) => void
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
        selected={value === 'test'}
        onClick={() => onChange('test')}
        disabled={disabled}
        label="Test"
      />
      <SegmentButton
        selected={value === 'live'}
        onClick={() => onChange('live')}
        disabled={disabled}
        label="Live"
        danger
      />
    </div>
  )
}

/** A three-segment Inherit/Test/Live control for a single household. */
function ThreeWaySegmented({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: 'inherit' | PaymentMode
  onChange: (v: 'inherit' | PaymentMode) => void
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
        selected={value === 'test'}
        onClick={() => onChange('test')}
        disabled={disabled}
        label="Test"
      />
      <SegmentButton
        selected={value === 'live'}
        onClick={() => onChange('live')}
        disabled={disabled}
        label="Live"
        danger
      />
    </div>
  )
}

/** One pill in a segmented control: raised card when selected, red when the
 * selected segment is the destructive 'Live' option. */
function SegmentButton({
  selected,
  onClick,
  disabled,
  label,
  danger,
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  label: string
  danger?: boolean
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
          ? danger
            ? 'bg-destructive text-destructive-foreground shadow-sm'
            : 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
