import { useState } from 'react'
import { Send, Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { submitFeedback } from '#/lib/app-feedback-server'
import { normaliseFeedback, FEEDBACK_CONTACT_EMAIL } from '#/lib/app-feedback'
import type { FeedbackSource } from '#/lib/app-feedback'

/**
 * The short feedback form (#404). Free-text message + an optional contact email,
 * with a mailto fallback for anyone who would rather email us directly. Validates
 * client-side through the same pure `normaliseFeedback` the server fn runs, then
 * POSTs to `submitFeedback`, which writes to the `app_feedback` admin inbox.
 *
 * Lives in its own component so it can be mounted from the floating bubble and
 * (later) anywhere else, without touching the app header or marketing Landing.
 */
export function FeedbackForm({
  source,
  onDone,
}: {
  source: FeedbackSource
  onDone?: () => void
}) {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const path =
    typeof window !== 'undefined' ? window.location.pathname : undefined

  async function send() {
    setError(null)
    const check = normaliseFeedback({ message, email, source, path })
    if (!check.ok) {
      setError(check.error)
      return
    }
    setSending(true)
    try {
      await submitFeedback({ data: { message, email, source, path } })
      setSent(true)
      // Give the confirmation a beat to read, then let the parent close.
      setTimeout(() => onDone?.(), 1200)
    } catch {
      setError('Could not send that. Please try again, or email us.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="bg-secondary text-primary flex h-12 w-12 items-center justify-center rounded-full">
          <Check className="h-6 w-6" />
        </span>
        <p className="text-base font-bold">Thank you</p>
        <p className="text-muted-foreground text-sm">
          We read every message. This really helps shape Souso.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-2">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Tell us what is working, what is not, or what you wish Souso did. We
        read every message.
      </p>

      <div className="space-y-1.5">
        <label htmlFor="feedback-message" className="text-sm font-semibold">
          Your feedback
        </label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="The swap button is hard to find on mobile…"
          className={cn(
            'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring',
            'flex w-full resize-none rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="feedback-email" className="text-sm font-semibold">
          Email{' '}
          <span className="text-muted-foreground font-normal">
            (optional, so we can reply)
          </span>
        </label>
        <Input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button
        size="pill"
        onClick={() => void send()}
        disabled={sending}
        className="gap-2"
      >
        <Send className="h-4 w-4" />
        {sending ? 'Sending…' : 'Send feedback'}
      </Button>

      <p className="text-muted-foreground text-center text-xs">
        Or email us at{' '}
        <a
          href={`mailto:${FEEDBACK_CONTACT_EMAIL}`}
          className="text-primary font-semibold underline-offset-2 hover:underline"
        >
          {FEEDBACK_CONTACT_EMAIL}
        </a>
      </p>
    </div>
  )
}
