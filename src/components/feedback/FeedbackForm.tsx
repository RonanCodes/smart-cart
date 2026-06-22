import { useEffect, useRef, useState } from 'react'
import { Send, Check, Camera, X, ImageIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { useSession } from '#/lib/auth-client'
import { submitFeedback } from '#/lib/app-feedback-server'
import {
  normaliseFeedback,
  feedbackEmailState,
  FEEDBACK_CONTACT_EMAIL,
} from '#/lib/app-feedback'
import type { FeedbackSource } from '#/lib/app-feedback'
import { captureSentryFeedback } from '#/lib/observability-client'

/**
 * The single feedback UI used everywhere (the redesigned feedback flow). It is
 * opened from the bottom tab-bar FAB and from Settings, and submits BOTH into
 * Sentry User Feedback (`captureSentryFeedback`, best-effort, prod-only) AND our
 * own `app_feedback` table (`submitFeedback`, the durable source of truth).
 *
 * Fields:
 * - message (required)
 * - email: prefilled + READ-ONLY when there is a signed-in session ("sending as
 *   <email>"); editable + optional when signed out. Decision is the pure
 *   `feedbackEmailState`, so it is unit-testable without rendering.
 * - phone / WhatsApp (optional) — "Open to a chat? Leave your number".
 * - an optional screenshot of the current page, captured with `html-to-image`
 *   (best-effort, never blocks submit). The feedback sheet is hidden while the
 *   capture runs so it is not in the shot.
 *
 * Validation runs through the pure `normaliseFeedback` (incl. phone).
 */
export function FeedbackForm({
  source,
  onDone,
}: {
  source: FeedbackSource
  onDone?: () => void
}) {
  const { data: session } = useSession()
  const sessionEmail = session?.user.email ?? null
  const emailState = feedbackEmailState(sessionEmail)

  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(emailState.value)
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Screenshot state: a data-URL preview + the raw PNG bytes for the Sentry
  // attachment. `capturing` hides the sheet so it isn't in the shot.
  const [shot, setShot] = useState<string | null>(null)
  const [shotBytes, setShotBytes] = useState<Uint8Array | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [shotError, setShotError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Keep the email field in sync if the session resolves after first render
  // (the field is read-only in that case, so we are not stomping user input).
  useEffect(() => {
    if (emailState.readOnly) setEmail(emailState.value)
  }, [emailState.readOnly, emailState.value])

  const path =
    typeof window !== 'undefined' ? window.location.pathname : undefined

  async function captureScreenshot() {
    setShotError(null)
    setCapturing(true)
    // Hide the whole feedback sheet for the shot, so it is not in the picture.
    const sheet = rootRef.current?.closest<HTMLElement>('[role="dialog"]')
    const prevVisibility = sheet?.style.visibility ?? ''
    if (sheet) sheet.style.visibility = 'hidden'
    try {
      // Let the browser paint the hidden sheet before we snapshot.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(document.body, {
        cacheBust: true,
        // Keep it light: skip fonts embedding failures, never block.
        skipFonts: true,
      })
      setShot(dataUrl)
      setShotBytes(dataUrlToBytes(dataUrl))
    } catch {
      // Best-effort: a capture failure never blocks feedback.
      setShotError('Could not grab a screenshot. You can still send your note.')
    } finally {
      if (sheet) sheet.style.visibility = prevVisibility
      setCapturing(false)
    }
  }

  function removeScreenshot() {
    setShot(null)
    setShotBytes(null)
    setShotError(null)
  }

  async function send() {
    setError(null)
    const check = normaliseFeedback({ message, email, phone, source, path })
    if (!check.ok) {
      setError(check.error)
      return
    }
    setSending(true)
    try {
      // (a) Sentry User Feedback (best-effort, prod-only, never throws).
      captureSentryFeedback({
        message: check.value.message,
        email: check.value.email,
        phone: check.value.phone,
        attachment: shotBytes
          ? { filename: 'screenshot.png', data: shotBytes }
          : null,
      })
      // (b) The durable app_feedback write (the source of truth).
      await submitFeedback({ data: { message, email, phone, source, path } })
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
    <div ref={rootRef} className="space-y-4 pb-2">
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
          {!emailState.readOnly && (
            <span className="text-muted-foreground font-normal">
              (optional, so we can reply)
            </span>
          )}
        </label>
        <Input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={emailState.readOnly}
          readOnly={emailState.readOnly}
        />
        {emailState.readOnly && (
          <p className="text-muted-foreground text-xs">Sending as {email}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="feedback-phone" className="text-sm font-semibold">
          Phone or WhatsApp{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="feedback-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+31 6 12 34 56 78"
        />
        <p className="text-muted-foreground text-xs">
          Open to a chat? Leave your number and we will reach out.
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-semibold">
          Screenshot{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </span>
        {shot ? (
          <div className="flex items-center gap-3">
            <img
              src={shot}
              alt="Screenshot to send with your feedback"
              className="border-border h-16 w-16 rounded-lg border object-cover"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={removeScreenshot}
              className="gap-1.5"
            >
              <X className="h-4 w-4" />
              Remove
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void captureScreenshot()}
            disabled={capturing}
            className="gap-2"
          >
            {capturing ? (
              <ImageIcon className="h-4 w-4 animate-pulse" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {capturing ? 'Capturing…' : 'Add screenshot'}
          </Button>
        )}
        {shotError && (
          <p className="text-muted-foreground text-xs">{shotError}</p>
        )}
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

/**
 * Decode a `data:image/png;base64,...` URL into the raw PNG bytes a Sentry
 * attachment expects. Pure + tiny; runs only in the browser (atob present).
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
