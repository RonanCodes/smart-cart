import { useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'

interface ChatReplanProps {
  /** Whether a replan is in flight. */
  busy: boolean
  /** Send the typed instruction to the replan engine. */
  onSubmit: (instruction: string) => void
  /** The assistant's narration as it streams in (shown while busy). */
  streamingText?: string
}

/**
 * Demo prompts that all produce a visible week change through the deterministic
 * replan parser (no API key needed). "make it cheaper" was dropped: it maps to a
 * not-built-yet pricing intent, so it only ever returned a dead-end message.
 */
const SUGGESTIONS = ['eating out Wednesday', 'no fish', 'more pasta']

/**
 * The chat box that drives a replan. Type a plain instruction ("eating out
 * Wednesday", "no fish") and the week re-renders. The suggestion chips are
 * tappable so the demo cases work on touch with no typing. No hover-only
 * affordances, mobile-first.
 */
export function ChatReplan({ busy, onSubmit, streamingText }: ChatReplanProps) {
  const [text, setText] = useState('')

  function submit(value: string) {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    onSubmit(trimmed)
    setText('')
  }

  return (
    <div className="bg-card border-border space-y-3 rounded-xl border p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="text-primary h-4 w-4" />
        Adjust your week
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Try: eating out Wednesday"
          disabled={busy}
          aria-label="Replan instruction"
        />
        <Button type="submit" size="icon" disabled={busy || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => submit(s)}
            className="bg-secondary text-secondary-foreground rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      {busy && streamingText ? (
        <p
          aria-live="polite"
          className="text-muted-foreground border-border/60 border-t pt-3 text-sm whitespace-pre-wrap"
        >
          {streamingText}
        </p>
      ) : null}
    </div>
  )
}
