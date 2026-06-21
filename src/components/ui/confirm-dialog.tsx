import type { ReactNode } from 'react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'

/**
 * ConfirmDialog — a small yes/no confirmation built on the bottom Sheet primitive
 * (NOT window.confirm, which is unstyled and blocks the main thread). Use it to
 * guard a destructive or elevating action: the action only runs when the user
 * taps Confirm.
 *
 * Mobile-first: it inherits the Sheet's iOS-style bottom-sheet presentation, so
 * the buttons sit at a comfortable thumb reach on a 390px screen and the whole
 * thing is dismissible (backdrop / Escape / swipe-down) the same way every other
 * sheet in the app is. On desktop the Sheet centres a max-w-md panel.
 *
 * Usage:
 *   const [open, setOpen] = useState(false)
 *   <ConfirmDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Make alice@b.com an admin?"
 *     confirmLabel="Make admin"
 *     onConfirm={() => void doIt()}
 *   />
 */
export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The question, shown as the sheet title (e.g. "Approve all 4 pending emails?"). */
  title: string
  /** Optional extra context under the title. */
  description?: ReactNode
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string
  /** Style the confirm button as destructive (red) instead of primary. */
  destructive?: boolean
  /** Disable the confirm button (e.g. while the action is in flight). */
  busy?: boolean
  /** Run the guarded action. The caller closes the dialog. */
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-5 pt-1 pb-2">
        {description && (
          <p className="text-muted-foreground text-center text-sm">
            {description}
          </p>
        )}
        {/* Stacked, full-width, 44px-tall touch targets. Confirm on top so the
            thumb lands on it first; Cancel below as the safe default tap-away. */}
        <div className="flex flex-col gap-2">
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy}
            onClick={onConfirm}
            className="h-12 w-full"
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="h-12 w-full"
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
