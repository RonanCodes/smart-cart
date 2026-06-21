import * as React from 'react'
import { cn } from '#/lib/utils'
import { Sheet } from '#/components/ui/sheet'
import { LOCALE_OPTIONS, setLocale } from '#/lib/locale-pref-server'
import type { Locale } from '#/lib/locale-pref-server'

/**
 * LanguageSheet — the Profile-tab language picker (#310), the in-app entry to the
 * recipe-content locale. Mirrors StoreSheet (#212): it PERSISTS straight away
 * through the `setLocale` server fn and reflects optimistically, rolling back on
 * a failed write.
 *
 * Recipe CONTENT follows the locale (week-card titles, the recipe sheet's
 * ingredients + steps); app chrome stays English in v1. A switch fires the
 * parent's `onChange` so it can invalidate the week loader + recipe detail and
 * re-render the new language immediately.
 *
 * The control is a clean segmented EN | NL toggle (with flag glyphs) rather than
 * a list of rows, since there are only two choices. Mobile-first at 390px: a
 * full-width, large-tap-target segmented switch.
 */
export function LanguageSheet({
  open,
  onOpenChange,
  current,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: Locale
  onChange: (locale: Locale) => void
}) {
  const [pending, setPending] = React.useState<Locale | null>(null)
  const [error, setError] = React.useState(false)

  async function pick(slug: Locale) {
    if (slug === current) return
    setError(false)
    setPending(slug)
    const previous = current
    onChange(slug) // optimistic
    try {
      await setLocale({ data: { locale: slug } })
    } catch {
      onChange(previous) // roll back
      setError(true)
    } finally {
      setPending(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Language">
      <p className="text-muted-foreground pb-3 text-sm">
        The language your recipes show in: their names, ingredients and steps.
        The rest of the app stays in English for now.
      </p>

      <div
        role="radiogroup"
        aria-label="Recipe language"
        className="bg-secondary flex gap-1 rounded-[var(--radius-ios)] p-1"
      >
        {LOCALE_OPTIONS.map((option) => {
          const selected = option.slug === current
          const saving = option.slug === pending
          return (
            <button
              key={option.slug}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending !== null}
              onClick={() => void pick(option.slug)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-ios)-0.25rem)] px-4 py-3 text-base font-semibold transition active:scale-[0.98]',
                selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground',
                pending !== null && !saving && 'opacity-70',
              )}
            >
              <span aria-hidden className="text-lg">
                {option.flag}
              </span>
              {option.name}
            </button>
          )
        })}
      </div>

      {error ? (
        <p role="status" className="text-muted-foreground pt-3 text-xs">
          Couldn&apos;t save that just now. Tap a language to try again.
        </p>
      ) : null}
    </Sheet>
  )
}
