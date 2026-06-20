import { useEffect, useRef, useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import type { MealRating as Rating } from '#/lib/meal-feedback'

interface MealRatingProps {
  /** The current saved rating for this dinner (null = not rated). */
  rating: Rating
  /** The current saved note, if any. */
  note: string | null
  /** Whether a write is in flight (buttons go busy). */
  busy: boolean
  /**
   * Submit a rating + note. A note is feedback on its own, so it saves with OR
   * without a thumb. Clearing the thumb keeps any note; emptying both drops the
   * row. Returns a promise so the control can show a pending state until the write
   * lands.
   */
  onSubmit: (next: { rating: Rating; note: string | null }) => Promise<void>
}

/**
 * Post-meal rating affordance for a cooked dinner (#126). Thumbs up / thumbs down
 * plus a clear, with an optional short note ("not pizza every week"). The chosen
 * rating stays reflected (filled thumb), and tapping the active thumb again clears
 * it WITHOUT dropping the note. The note box is always available (a household can
 * jot "not pizza every week" with no thumb at all); the note saves on blur or when
 * the user taps Save.
 *
 * Mobile-first at 390px, iOS styling: big tap targets (44px min), no hover-only
 * affordance (every control is a real button), rounded fills, the brand accent for
 * the active state. A thumb writes `'up' | 'down'`, the literal the recommender
 * folds into next week (recsys/feedback-fold), so a thumbs-down visibly shifts
 * future suggestions; a note-only feedback adds context without moving the recsys.
 */
export function MealRating({ rating, note, busy, onSubmit }: MealRatingProps) {
  const [draftNote, setDraftNote] = useState(note ?? '')
  const lastSavedNote = useRef(note ?? '')

  // Keep local draft in sync when the saved state changes underneath us (e.g. a
  // fresh load or a clear), without clobbering an in-progress edit.
  useEffect(() => {
    setDraftNote(note ?? '')
    lastSavedNote.current = note ?? ''
  }, [note, rating])

  async function choose(next: 'up' | 'down') {
    // Tapping the already-active thumb clears the thumb, but keeps any note: the
    // note is its own signal, so clearing a thumb must not silently wipe it.
    const value: Rating = rating === next ? null : next
    const noteToSend = draftNote.trim() || null
    await onSubmit({ rating: value, note: noteToSend })
  }

  async function saveNote() {
    const trimmed = draftNote.trim() || null
    // Nothing changed since the last save -> no write.
    if (trimmed === (lastSavedNote.current.trim() || null)) return
    // A note saves on its own; the current thumb (if any) rides along unchanged.
    await onSubmit({ rating, note: trimmed })
  }

  return (
    <div className="border-border/60 mt-1 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs font-medium">
          Cooked it? Rate this dinner
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            aria-pressed={rating === 'up'}
            aria-label="Thumbs up"
            onClick={() => void choose('up')}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:opacity-50',
              rating === 'up'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground bg-background',
            )}
          >
            <ThumbsUp className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={rating === 'down'}
            aria-label="Thumbs down"
            onClick={() => void choose('down')}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors disabled:opacity-50',
              rating === 'down'
                ? 'bg-destructive border-destructive text-destructive-foreground'
                : 'border-border text-muted-foreground bg-background',
            )}
          >
            <ThumbsDown className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={draftNote}
          disabled={busy}
          onChange={(e) => setDraftNote(e.target.value)}
          onBlur={() => void saveNote()}
          rows={2}
          maxLength={280}
          placeholder="Add a note (optional), e.g. not pizza every week"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full resize-none rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void saveNote()}
          >
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>
    </div>
  )
}
