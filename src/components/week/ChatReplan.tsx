import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Send, Sparkles } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import type { ReplanHistoryTurn } from '#/lib/agent/replan-client'

/** One bubble in the chat thread. */
interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

interface ChatReplanProps {
  /** Whether a replan is in flight. */
  busy: boolean
  /**
   * Run the replan. Receives the typed instruction plus the PRIOR conversation
   * turns (so a follow-up answer to Souso's clarifying question is understood in
   * context), and resolves with Souso's reply text, which becomes the assistant
   * bubble. The grid + URL updates are still driven by the parent.
   */
  onSubmit: (
    instruction: string,
    history: Array<ReplanHistoryTurn>,
  ) => Promise<string>
  /** The assistant's narration as it streams in (shown in the pending bubble). */
  streamingText?: string
  /**
   * Show the looping "Souso is working" glow on this card WHILE a replan is in
   * flight and no specific DayCard is the target yet (#replan-ux). When a target
   * day is known the DayCard glows instead, so this card stays calm.
   */
  working?: boolean
}

/**
 * Demo prompts that all produce a visible week change through the deterministic
 * replan parser (no API key needed). "make it cheaper" was dropped: it maps to a
 * not-built-yet pricing intent, so it only ever returned a dead-end message.
 */
const SUGGESTIONS = ['eating out Wednesday', 'no fish', 'more pasta']

/**
 * How many prior turns to carry into a follow-up. A replan conversation is
 * short (a question and an answer), so a handful is plenty and keeps the prompt
 * small. The server clamps again defensively.
 */
const MAX_HISTORY_TURNS = 6

/**
 * The chat box that drives a replan, now a small MESSAGE THREAD (#replan-ux).
 * Type a plain instruction ("eating out Wednesday"); Souso replies in a bubble.
 * If Souso asks a clarifying question, the user can answer in the same input and
 * the prior turns are threaded back so the answer lands in context. The
 * suggestion chips stay tappable so the demo cases work on touch with no typing.
 * No hover-only affordances, mobile-first.
 */
export function ChatReplan({
  busy,
  onSubmit,
  streamingText,
  working = false,
}: ChatReplanProps) {
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Array<ChatTurn>>([])
  const threadRef = useRef<HTMLDivElement>(null)

  // Autoscroll the thread to the latest bubble as it grows / streams.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, streamingText, busy])

  async function submit(value: string) {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    // The prior turns (everything already in the thread) are the context for
    // this instruction; the new user message is appended optimistically.
    const history: Array<ReplanHistoryTurn> = turns
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ role: t.role, text: t.text }))
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }])
    setText('')
    let reply: string
    try {
      reply = await onSubmit(trimmed, history)
    } catch {
      reply = 'Could not adjust the week, try again.'
    }
    setTurns((prev) => [...prev, { role: 'assistant', text: reply }])
  }

  const hasThread = turns.length > 0 || busy

  return (
    <div
      className={clsx(
        'bg-card border-border space-y-3 rounded-xl border p-4 shadow-sm',
        working && 'ai-glow-pulse',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="text-primary h-4 w-4" />
        Adjust your week
      </div>

      {hasThread && (
        <div
          ref={threadRef}
          className="border-border/60 max-h-64 space-y-2 overflow-y-auto border-t pt-3"
          aria-live="polite"
        >
          {turns.map((t, i) => (
            <Bubble key={i} role={t.role} text={t.text} />
          ))}
          {/* The in-flight assistant turn: streamed narration as it arrives. */}
          {busy && (
            <Bubble
              role="assistant"
              text={
                streamingText?.trim() ? streamingText : 'Souso is thinking…'
              }
              pending
            />
          )}
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(text)
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            turns.length > 0 ? 'Reply to Souso…' : 'Try: eating out Wednesday'
          }
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
            onClick={() => void submit(s)}
            className="bg-secondary text-secondary-foreground rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A single chat bubble: user right-aligned, Souso left-aligned. */
function Bubble({
  role,
  text,
  pending = false,
}: {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <p
        className={clsx(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-secondary text-secondary-foreground rounded-bl-sm',
          pending && 'opacity-80',
        )}
      >
        {text}
      </p>
    </div>
  )
}
