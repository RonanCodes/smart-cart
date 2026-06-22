import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send, Check, Camera, X } from 'lucide-react'
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
 * - an optional screenshot: the user ATTACHES one (file picker → their native
 *   phone/desktop screenshot). In-app DOM-to-canvas capture (html-to-image) was
 *   dropped — it produced low-quality, broken-looking uploads in Sentry. A native
 *   screenshot is pixel-perfect and uploads cleanly as the Sentry attachment.
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

  // Attached screenshot: a data-URL preview + the raw bytes (for the Sentry
  // attachment) + the original filename. The user picks an image file (a native
  // screenshot), so it is whatever they actually see on their screen.
  const [shot, setShot] = useState<string | null>(null)
  const [shotBytes, setShotBytes] = useState<Uint8Array | null>(null)
  const [shotName, setShotName] = useState('screenshot.png')
  const [shotError, setShotError] = useState<string | null>(null)
  // The attached shot, opened full-screen so the user can inspect exactly what
  // they are about to send before sending it.
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Keep the email field in sync if the session resolves after first render
  // (the field is read-only in that case, so we are not stomping user input).
  useEffect(() => {
    if (emailState.readOnly) setEmail(emailState.value)
  }, [emailState.readOnly, emailState.value])

  const path =
    typeof window !== 'undefined' ? window.location.pathname : undefined

  async function onScreenshotFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = ''
    if (!file) return
    setShotError(null)
    if (!file.type.startsWith('image/')) {
      setShotError('Please choose an image file.')
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dataUrl = await fileToDataUrl(file)
      setShot(dataUrl)
      setShotBytes(bytes)
      setShotName(file.name || 'screenshot.png')
    } catch {
      setShotError('Could not read that image. Try another one.')
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
      // (a) Sentry User Feedback (best-effort, never throws). Awaited so its
      // internal flush completes BEFORE the panel closes / the user navigates —
      // the envelope is otherwise queued and can be abandoned on close (#443).
      await captureSentryFeedback({
        message: check.value.message,
        email: check.value.email,
        phone: check.value.phone,
        attachment: shotBytes ? { filename: shotName, data: shotBytes } : null,
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
        {/* Hidden file input — the user attaches a native screenshot (crisp). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onScreenshotFile(e)}
        />
        {shot ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label="View screenshot full screen"
              className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <img
                src={shot}
                alt="Screenshot to send with your feedback. Tap to view full screen."
                className="border-border h-16 w-16 rounded-lg border object-cover"
              />
            </button>
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
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Camera className="h-4 w-4" />
            Attach a screenshot
          </Button>
        )}
        <p className="text-muted-foreground text-xs">
          {shot
            ? 'Tap the image to check what you are sending.'
            : 'Take a screenshot on your device, then attach it here.'}
        </p>
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

      {lightboxOpen && shot && (
        <ScreenshotLightbox src={shot} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}

/**
 * Full-screen lightbox so the user can inspect EXACTLY what the screenshot
 * contains before they send it. Portalled to `document.body`, dismissed by the
 * close button, a backdrop tap, or Escape.
 */
function ScreenshotLightbox({
  src,
  onClose,
}: {
  src: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close screenshot preview"
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt="Full-screen preview of the screenshot you are about to send"
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body,
  )
}

/** Read an image File into a `data:` URL for the preview/lightbox <img>. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
