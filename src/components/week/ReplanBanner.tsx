import { useState } from 'react'
import { ChevronDown, ArrowRight } from 'lucide-react'
import { cn } from '#/lib/utils'
import type { PlanDayChange } from '#/lib/replan/diff'

/**
 * The status banner shown after a replan. It always shows the summary message
 * (e.g. "Removed fish from 3 dinners."). When the replan touched one or more
 * days, a "Show changes" disclosure sits under the message; tapping it reveals
 * the exact per-day diff, old dish -> new dish. Collapsed by default so the
 * banner stays tidy, and the list renders in-place so there is no layout jump
 * beyond the disclosure itself opening.
 *
 * Mobile-first: built for 390px, the dish titles truncate rather than wrap the
 * row, and the whole disclosure is a single full-width tap target.
 */
export function ReplanBanner({
  message,
  changes,
}: {
  message: string
  changes: Array<PlanDayChange>
}) {
  const [open, setOpen] = useState(false)
  const hasChanges = changes.length > 0

  return (
    <div
      role="status"
      className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm"
    >
      <p>{message}</p>

      {hasChanges && (
        <div className="mt-2 border-t border-current/10 pt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-muted-foreground flex w-full items-center justify-between gap-2 text-xs font-medium"
          >
            <span>{open ? 'Hide changes' : 'Show changes'}</span>
            <ChevronDown
              className={cn('h-4 w-4 transition', open && 'rotate-180')}
              aria-hidden
            />
          </button>

          {open && (
            <ul className="mt-2 space-y-1.5">
              {changes.map((c) => (
                <li key={c.day} className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground font-medium">
                    {c.day}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="text-muted-foreground min-w-0 flex-1 truncate line-through">
                      {c.removedTitle || 'nothing'}
                    </span>
                    <ArrowRight
                      className="text-muted-foreground/70 h-3 w-3 shrink-0"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {c.addedTitle || 'eating out'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
