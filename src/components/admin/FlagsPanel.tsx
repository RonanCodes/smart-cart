import { useState } from 'react'
import { Power, PowerOff, ShieldAlert } from 'lucide-react'
import { setFlags } from '#/lib/flags-server'
import { FLAG_META, ORDERING_FLAG_KEYS, storeOrderable } from '#/lib/flags'
import type { FlagKey, FlagSet, FlagMeta } from '#/lib/flags'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { cn } from '#/lib/utils'

/**
 * Admin "Feature flags" panel. One on/off toggle per flag, grouped by store +
 * checkout, plus a "Disable all ordering" master button (the emergency
 * kill-switch when checkout is dodgy). Writes go through the admin-gated
 * setFlags server fn, which returns the resulting full FlagSet so the panel
 * stays in sync after every change.
 *
 * Flags are scoped to THIS environment's D1 (dev.souso.app writes the dev DB,
 * souso.app writes the prod DB), so toggling here only affects the environment
 * the admin is signed into.
 */
export function FlagsPanel({ initial }: { initial: FlagSet }) {
  const [flags, setLocalFlags] = useState<FlagSet>(initial)
  const [busy, setBusy] = useState<FlagKey | 'all-ordering' | null>(null)
  const [error, setError] = useState(false)

  async function apply(
    updates: Array<{ key: FlagKey; enabled: boolean }>,
    busyKey: FlagKey | 'all-ordering',
  ) {
    if (busy) return
    setBusy(busyKey)
    setError(false)
    try {
      const next = await setFlags({ data: { updates } })
      setLocalFlags(next)
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }

  function toggle(key: FlagKey) {
    void apply([{ key, enabled: !flags[key] }], key)
  }

  function disableAllOrdering() {
    void apply(
      ORDERING_FLAG_KEYS.map((key) => ({ key, enabled: false })),
      'all-ordering',
    )
  }

  // FLAG_META is already in display order; group consecutively by `group`.
  const groups: Array<{ name: string; flags: Array<FlagMeta> }> = []
  for (const meta of FLAG_META) {
    const last = groups[groups.length - 1]
    if (last && last.name === meta.group) last.flags.push(meta)
    else groups.push({ name: meta.group, flags: [meta] })
  }

  const anyOrderingOn = (['ah', 'jumbo', 'picnic'] as const).some((s) =>
    storeOrderable(flags, s),
  )

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Feature flags</h2>
            <p className="text-muted-foreground text-sm">
              Turn stores, ordering and tipping on or off for this environment.
              Changes take effect on the next page load.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={busy !== null || !anyOrderingOn}
            onClick={disableAllOrdering}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden />
            {busy === 'all-ordering' ? 'Disabling…' : 'Disable all ordering'}
          </Button>
        </div>
      </Card>

      {groups.map((group) => (
        <Card key={group.name} className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold tracking-tight">{group.name}</h3>
          <div className="flex flex-col gap-2">
            {group.flags.map((meta) => {
              const on = flags[meta.key]
              const saving = busy === meta.key
              return (
                <div
                  key={meta.key}
                  className="border-border flex items-center justify-between gap-4 rounded-xl border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{meta.label}</p>
                    <p className="text-muted-foreground text-xs">
                      {meta.description}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    aria-label={`${meta.label}: ${on ? 'on' : 'off'}`}
                    disabled={busy !== null}
                    onClick={() => toggle(meta.key)}
                    className={cn(
                      'w-24 shrink-0 gap-1.5',
                      saving && 'opacity-70',
                    )}
                  >
                    {on ? (
                      <Power className="h-4 w-4" aria-hidden />
                    ) : (
                      <PowerOff className="h-4 w-4" aria-hidden />
                    )}
                    {saving ? 'Saving…' : on ? 'On' : 'Off'}
                  </Button>
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      {error ? (
        <p role="status" className="text-destructive text-sm">
          Couldn&apos;t save that just now. Try again.
        </p>
      ) : null}
    </div>
  )
}
