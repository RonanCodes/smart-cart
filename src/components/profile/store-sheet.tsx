import * as React from 'react'
import { Check } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { cn } from '#/lib/utils'
import { STORE_OPTIONS, setStore } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { storeVisible } from '#/lib/flags'
import { useFlags } from '#/lib/flags-context'

/**
 * StoreSheet — the Profile-tab store picker (#212), the in-app entry to the
 * preferred-store selector (#93). Mirrors the onboarding Store step (#109): the
 * same three Dutch stores from the shared STORE_OPTIONS catalogue, the same
 * brand styling, but here it PERSISTS straight away through the `setStore`
 * server fn rather than patching an in-flight draft.
 *
 * Selectable stores write the choice on tap and reflect immediately (the
 * parent's trailing value updates) (#294). A failed write rolls the optimistic
 * value back and shows a quiet note; the sheet stays open so the user can retry.
 * Which stores are selectable is feature-flagged (lib/flags.ts
 * `store.<slug>.visible`): a store whose visible flag is off shows as a disabled
 * "Coming soon" row; tapping it does nothing.
 *
 * Mobile-first at 390px: full-width tappable rows, iOS sheet styling, calm copy.
 */
export function StoreSheet({
  open,
  onOpenChange,
  current,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: StoreSlug
  onChange: (store: StoreSlug) => void
}) {
  const [pending, setPending] = React.useState<StoreSlug | null>(null)
  const [error, setError] = React.useState(false)
  const flags = useFlags()

  async function pick(slug: StoreSlug) {
    if (slug === current || !storeVisible(flags, slug)) return
    setError(false)
    setPending(slug)
    const previous = current
    onChange(slug) // optimistic
    try {
      await setStore({ data: { store: slug } })
    } catch {
      onChange(previous) // roll back
      setError(true)
    } finally {
      setPending(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Preferred store">
      <div
        role="radiogroup"
        aria-label="Preferred store"
        className="flex flex-col gap-3 pt-2 pb-2"
      >
        {STORE_OPTIONS.map((option) => {
          // A store whose `visible` flag is off shows as a disabled "Coming soon" row.
          const comingSoon = !storeVisible(flags, option.slug)
          const selected = option.slug === current && !comingSoon
          const saving = option.slug === pending
          return (
            <button
              key={option.name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={comingSoon}
              disabled={pending !== null || comingSoon}
              onClick={() => void pick(option.slug)}
              className={cn(
                'flex items-center gap-4 rounded-[var(--radius-ios)] border p-4 text-left transition active:scale-[0.98]',
                selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
                pending !== null && !saving && 'opacity-70',
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
              ) : saving ? (
                <span className="text-muted-foreground shrink-0 text-xs">
                  Saving…
                </span>
              ) : selected ? (
                <Check aria-hidden className="text-primary h-6 w-6 shrink-0" />
              ) : null}
            </button>
          )
        })}
      </div>

      {error ? (
        <p role="status" className="text-muted-foreground pb-2 text-xs">
          Couldn&apos;t save that just now. Tap a store to try again.
        </p>
      ) : null}
    </Sheet>
  )
}
