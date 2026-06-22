import * as React from 'react'
import { cn } from '#/lib/utils'

/**
 * Sheet — an iOS-style bottom sheet. It springs up from the bottom edge over a
 * dimmed backdrop, shows a grabber handle, and is dismissible three ways:
 * tapping the backdrop, pressing Escape, or dragging the handle/header down past
 * a threshold (swipe-to-dismiss). Built with CSS transitions + a little state,
 * no new dependency.
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *   <Sheet open={open} onOpenChange={setOpen} title="Swap this dinner">
 *     ...content...
 *   </Sheet>
 *
 * The component keeps itself mounted for one exit animation after `open` flips
 * to false, then unmounts, so the slide-down is visible.
 */
export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  children: React.ReactNode
  /** Disable swipe-to-dismiss (e.g. a sheet that must be confirmed). */
  dismissible?: boolean
  className?: string
}

const SWIPE_CLOSE_THRESHOLD = 100 // px dragged down before we dismiss

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  dismissible = true,
  className,
}: SheetProps) {
  const [mounted, setMounted] = React.useState(open)
  const [drag, setDrag] = React.useState(0)
  const startY = React.useRef<number | null>(null)
  // Latest `open`, read in the deferred unmount without a stale closure (#383).
  const openRef = React.useRef(open)
  openRef.current = open

  // Keep mounted through the exit animation.
  React.useEffect(() => {
    if (open) {
      setMounted(true)
      setDrag(0)
    }
  }, [open])

  // Close on Escape while open.
  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!mounted) return null

  const state = open ? 'open' : 'closed'

  // Unmount only when STILL closed (#383). The exit animation fires on both the
  // backdrop and the panel; if `open` flipped back to true in between (reopened
  // fast), unmounting here would tear down a now-open sheet and React could try
  // to remove a node the browser had already moved, throwing NotFoundError ("the
  // object can not be found here"). Re-checking the latest `open` via a ref (not
  // the closed-over `open`) means a reopen wins and the live sheet stays mounted.
  function onAnimationEnd() {
    if (!openRef.current) setMounted(false)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!dismissible) return
    startY.current = e.clientY
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null) return
    const dy = e.clientY - startY.current
    setDrag(Math.max(0, dy)) // only allow dragging down
  }
  function onPointerUp() {
    if (startY.current === null) return
    if (drag > SWIPE_CLOSE_THRESHOLD) {
      onOpenChange(false)
    } else {
      setDrag(0)
    }
    startY.current = null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="presentation"
    >
      <div
        data-state={state}
        className="sheet-backdrop absolute inset-x-0 bg-black/40"
        // #438: on an iOS standalone PWA the dim backdrop must reach the very top
        // of the screen, into env(safe-area-inset-top) (the notch / camera area).
        // The fixed container already spans inset-0 with viewport-fit=cover, but
        // we make the backdrop itself extend ABOVE top:0 by the top inset (and grow
        // its height by the same amount) so the curved notch area is dimmed too,
        // never left as a bright uncovered strip.
        style={{
          top: 'calc(-1 * env(safe-area-inset-top, 0px))',
          height: 'calc(100% + env(safe-area-inset-top, 0px))',
        }}
        onClick={() => dismissible && onOpenChange(false)}
        aria-hidden
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onAnimationEnd()
        }}
      />
      <div
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'sheet-panel bg-card text-card-foreground relative z-10 w-full max-w-md',
          'max-h-[88dvh] overflow-hidden shadow-2xl',
          'rounded-t-[var(--radius-ios)]',
          className,
        )}
        style={{
          paddingBottom: 'calc(var(--safe-bottom) + 1rem)',
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: startY.current === null ? 'transform 0.2s ease' : 'none',
        }}
        onAnimationEnd={onAnimationEnd}
      >
        {/* Grabber + (optional) header double as the drag target. */}
        <div
          className="cursor-grab touch-none pt-2 pb-1 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="bg-border mx-auto h-1.5 w-10 rounded-full" />
          {title && (
            <h2 className="px-5 pt-3 text-center text-base font-semibold">
              {title}
            </h2>
          )}
        </div>
        <div className="ios-scroll max-h-[78dvh] overflow-y-auto px-5 pt-2">
          {children}
        </div>
      </div>
    </div>
  )
}
