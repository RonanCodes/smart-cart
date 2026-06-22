import { useState } from 'react'
import { MessageCircleHeart } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { FeedbackForm } from './FeedbackForm'

/**
 * A small, persistent floating "feedback bubble" (#404). Sits just above the tab
 * bar, aligned to the right edge of the phone-width column, and opens the short
 * feedback form in a bottom sheet. Deliberately unobtrusive: a single olive
 * round button on brand, no copy until tapped.
 *
 * Mounted once in the authed layout (`_authed.tsx`) so it follows the user across
 * every gated screen without each route wiring it. It does NOT touch the app
 * header or the marketing Landing (owned elsewhere).
 *
 * The outer wrapper is a full-width, centered, max-w-md row pinned above the tab
 * bar; `pointer-events-none` on it lets taps fall through everywhere except the
 * button itself, so the bubble never blocks the screen beneath it.
 */
export function FeedbackBubble() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-30 flex justify-center"
        style={{ bottom: 'calc(var(--tab-bar-space) + 0.75rem)' }}
      >
        <div className="flex w-full max-w-md justify-end px-4">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Send feedback"
            title="Send feedback"
            className="bg-primary text-primary-foreground pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1 ring-black/5 transition active:scale-95"
          >
            <MessageCircleHeart className="h-5 w-5" />
          </button>
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen} title="Send feedback">
        <FeedbackForm source="bubble" onDone={() => setOpen(false)} />
      </Sheet>
    </>
  )
}
