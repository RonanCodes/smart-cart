import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  // The captured shot, opened full-screen so the user can inspect exactly what
  // they are about to send before sending it.
  const [lightboxOpen, setLightboxOpen] = useState(false)
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
    // Hide the ENTIRE feedback overlay for the shot — not just the dialog panel
    // but its parent (the `fixed inset-0` container that also holds the dimmed
    // backdrop), so neither the panel NOR the dim wash ends up in the picture.
    const dialog = rootRef.current?.closest<HTMLElement>('[role="dialog"]')
    const overlay = dialog?.parentElement ?? dialog ?? null
    const prevVisibility = overlay?.style.visibility ?? ''
    if (overlay) overlay.style.visibility = 'hidden'
    try {
      // Two frames so the browser fully paints the hidden overlay before we snap.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(document.body, {
        // Mobile perf: the default captures at devicePixelRatio (2-3x on phones,
        // so 4-9x the pixels) AND cacheBust re-fetches every image with a unique
        // query string. Both made the capture crawl on mobile. Pin pixelRatio to
        // 1 (a feedback screenshot does not need retina) and drop cacheBust; a
        // legibility-fine, much faster snapshot.
        pixelRatio: 1,
        cacheBust: false,
        // Keep it light: skip fonts embedding failures, never block.
        skipFonts: true,
        // Drop any node we explicitly mark (the "taking a screenshot" banner the
        // user sees while the panel is hidden) so it never lands in the shot.
        filter: excludeFromScreenshot,
      })
      setShot(dataUrl)
      setShotBytes(dataUrlToBytes(dataUrl))
    } catch {
      // Best-effort: a capture failure never blocks feedback.
      setShotError('Could not grab a screenshot. You can still send your note.')
    } finally {
      if (overlay) overlay.style.visibility = prevVisibility
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
      // (a) Sentry User Feedback (best-effort, never throws). Awaited so its
      // internal flush completes BEFORE the panel closes / the user navigates —
      // the envelope is otherwise queued and can be abandoned on close (#443).
      await captureSentryFeedback({
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
        {shot && (
          <p className="text-muted-foreground text-xs">
            Tap the image to check what you are sending.
          </p>
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

      {capturing && <ScreenshotCapturingBanner />}
      {lightboxOpen && shot && (
        <ScreenshotLightbox src={shot} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}

/**
 * The on-brand banner the user actually sees while the feedback panel is hidden
 * for the capture. Rendered into a portal on `document.body` so it sits OUTSIDE
 * the hidden overlay (which has `visibility: hidden`), pinned to the bottom edge.
 * Marked with `data-screenshot-exclude` and skipped by `excludeFromScreenshot`,
 * so it is visible to the user but never lands in the shot.
 */
function ScreenshotCapturingBanner() {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      {...SCREENSHOT_EXCLUDE_ATTR}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg">
        <ImageIcon className="h-4 w-4 animate-pulse" />
        Taking a screenshot, one moment…
      </div>
    </div>,
    document.body,
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

/**
 * The marker that tells `excludeFromScreenshot` to drop a node from the capture.
 * Spread onto the "taking a screenshot" banner so the user sees it during the
 * shot but it never lands in the PNG. A `data-` attribute (not a class) so it is
 * a stable, intent-revealing hook that styling churn can't break.
 */
const SCREENSHOT_EXCLUDE = 'data-screenshot-exclude'
const SCREENSHOT_EXCLUDE_ATTR = { [SCREENSHOT_EXCLUDE]: 'true' } as const

/**
 * html-to-image `filter`: return false to drop a node (and its whole subtree)
 * from the capture. We skip any element carrying `data-screenshot-exclude` — the
 * capturing banner — so it is visible on screen but excluded from the shot.
 * Exported for the unit test. Non-element nodes (text) always pass through.
 */
export function excludeFromScreenshot(node: HTMLElement): boolean {
  if (typeof node.hasAttribute !== 'function') return true
  return !node.hasAttribute(SCREENSHOT_EXCLUDE)
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
