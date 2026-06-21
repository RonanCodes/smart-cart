import { Resend } from 'resend'
import { readEnv } from './env'

// Sends from the verified ronanconnolly.dev Resend account (the RESEND_API_KEY
// secret holds that key).
const FROM = 'Souso <hello@ronanconnolly.dev>'
// Where waitlist-signup pings land.
const ADMIN_NOTIFY_TO = 'tech@discopenguin.com'
// The full Souso brand mark (chef's toque + "Souso" wordmark) rendered cream on
// transparent so it reads on the green header band. Email clients render PNG,
// not SVG, and need an absolute URL, so this points at the prod email-logo.
const MASCOT = 'https://souso.app/email-logo.png?v=5'
const GREEN = '#43A047'
const CANVAS = '#FBFDF9'

/**
 * Shared mobile-first email shell: header band with the mascot, a body block,
 * and the footer. `inner` is the body HTML. Keeping one shell means the OTP and
 * approval emails render identically in Gmail / Apple Mail.
 */
function emailShell(inner: string): string {
  return `
  <div style="background:${CANVAS};padding:32px 0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e7eee7;border-radius:16px;overflow:hidden;">
      <div style="background:${GREEN};padding:20px 28px;text-align:center;">
        <img src="${MASCOT}" alt="Souso" width="180" height="111" style="display:inline-block;vertical-align:middle;" />
      </div>
      <div style="padding:32px 28px;text-align:center;">
        ${inner}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #f0f4f0;text-align:center;">
        <p style="color:#9aa89a;font-size:12px;margin:0;">Souso, your sous chef</p>
      </div>
    </div>
  </div>`
}

/** A full-width, finger-friendly green tap button. Used by both emails. */
function tapButton(href: string, label: string): string {
  return `<a href="${href}" style="display:block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 20px;border-radius:12px;text-align:center;">${label}</a>`
}

/**
 * The OTP sign-in email body. The 6-digit code stays primary and is always the
 * fallback. When a one-tap magic link is supplied (issue #259) it renders below
 * the code as "or just tap here to sign in", so the user can click instead of
 * typing. No magic link -> code-only, the original layout.
 */
function otpHtml(code: string, magicLinkUrl?: string): string {
  const spaced = code.split('').join('&nbsp;')
  const tapBlock = magicLinkUrl
    ? `<p style="color:#9aa89a;font-size:13px;margin:0 0 12px;">or just tap here to sign in</p>
       ${tapButton(magicLinkUrl, 'Sign in to Souso')}
       <p style="color:#b6c2b6;font-size:11px;line-height:1.5;margin:16px 0 0;">This link signs you in directly and works once. Prefer the code? Type it above.</p>`
    : ''
  return emailShell(`
        <p style="color:#5b6b5b;margin:0 0 20px;font-size:15px;">Your sign-in code:</p>
        <p style="font-size:38px;font-weight:800;letter-spacing:8px;color:#1f2a1f;margin:0 0 24px;">${spaced}</p>
        <p style="color:#8a988a;font-size:13px;line-height:1.5;margin:0 0 ${magicLinkUrl ? '24px' : '0'};">It expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
        ${tapBlock}`)
}

/**
 * The launch-announcement email body: Souso has gone live. A celebratory line
 * plus one big "open Souso" button to the sign-in page (the gate is open now, so
 * anyone can sign in with a code).
 */
function launchHtml(signInUrl: string): string {
  return emailShell(`
        <p style="font-size:40px;margin:0 0 8px;">🎉</p>
        <p style="color:#1f2a1f;font-size:22px;font-weight:800;margin:0 0 8px;">Souso is live</p>
        <p style="color:#5b6b5b;margin:0 0 24px;font-size:15px;line-height:1.5;">Your sous-chef is ready to plan your week of dinners and turn it into one grocery cart. Tap below and tell Souso who you're cooking for.</p>
        ${tapButton(signInUrl, 'Open Souso')}
        <p style="color:#b6c2b6;font-size:11px;line-height:1.5;margin:16px 0 0;">Sign in with your email, we'll send a 6-digit code.</p>`)
}

/** The approval email body: a welcome line plus one big sign-in button. */
function approvalHtml(magicLinkUrl: string): string {
  return emailShell(`
        <p style="color:#1f2a1f;font-size:20px;font-weight:800;margin:0 0 8px;">You're in.</p>
        <p style="color:#5b6b5b;margin:0 0 24px;font-size:15px;line-height:1.5;">Your spot on Souso is ready. Tap below to sign in, no code to type.</p>
        ${tapButton(magicLinkUrl, 'Sign in to Souso')}
        <p style="color:#b6c2b6;font-size:11px;line-height:1.5;margin:16px 0 0;">This link signs you in directly and works once. If you didn't expect this, you can ignore it.</p>`)
}

/**
 * Send the sign-in one-time code. Throws if Resend is unconfigured so the auth
 * flow surfaces a clear error rather than silently failing to deliver the code.
 *
 * When `magicLinkUrl` is supplied (issue #259) the email shows the code AND an
 * "or just tap here to sign in" one-tap link below it. The typed code always
 * stays as the fallback, so a missing link degrades to the original code-only
 * email. The magic link is NEVER logged.
 */
export async function sendOtpEmail(
  to: string,
  code: string,
  magicLinkUrl?: string,
): Promise<void> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set, cannot send the sign-in code.')
  }
  const resend = new Resend(apiKey)
  const tapText = magicLinkUrl
    ? `\n\nOr just tap here to sign in directly: ${magicLinkUrl}`
    : ''
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your Souso code: ${code}`,
    text: `Your Souso sign-in code is ${code}. It expires in 10 minutes.${tapText}`,
    html: otpHtml(code, magicLinkUrl),
  })
  if (error) {
    throw new Error(`Resend failed to send the sign-in code: ${error.message}`)
  }
}

/**
 * Send the approval email (issue #259): when an admin approves a waitlisted
 * person, they get a one-tap magic sign-in link that drops them straight into
 * onboarding (or their week plan if already onboarded). No code to type. Throws
 * if Resend is unconfigured; the approval write has already committed by the
 * time this is called, so the caller treats a send failure as best-effort. The
 * magic link is NEVER logged.
 */
export async function sendApprovalEmail(
  to: string,
  magicLinkUrl: string,
): Promise<void> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY is not set, cannot send the approval email.',
    )
  }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `You're in: welcome to Souso`,
    text: `You're approved for Souso. Tap here to sign in, no code needed: ${magicLinkUrl}`,
    html: approvalHtml(magicLinkUrl),
  })
  if (error) {
    throw new Error(
      `Resend failed to send the approval email: ${error.message}`,
    )
  }
}

/** The launch email subject line. Exported so the admin UI can preview the exact
 * subject that will be sent without re-typing it (single source of truth). */
export const LAUNCH_EMAIL_SUBJECT = 'Souso is live 🎉'

/**
 * The launch email plain-text body, exported so the admin broadcast panel can show
 * a readable preview of what every recipient receives. `{signInUrl}` is the only
 * variable; `launchEmailText` fills it for the real send. Plain and warm, no
 * em-dashes. The HTML version (`launchHtml`) carries the same message visually.
 */
export const LAUNCH_EMAIL_BODY =
  "Souso is live. Your sous-chef is ready to plan your week of dinners and turn it into one grocery cart. Open Souso, sign in with your email, and tell it who you're cooking for."

/** Build the launch email plain-text fallback, appending the sign-in link. */
export function launchEmailText(signInUrl: string): string {
  return `${LAUNCH_EMAIL_BODY}\n\nOpen Souso: ${signInUrl}`
}

/**
 * Send ONE person the "Souso is live" launch email. Best-effort: returns
 * { sent } and never throws (the launch toggle has already committed by the time
 * this runs, and one bad address must not abort the rest of the broadcast). A
 * missing RESEND_API_KEY is a no-op `{ sent: false }`. The sign-in URL points at
 * the live app's /sign-in; the gate is open post-launch, so anyone can sign in.
 */
export async function sendLaunchEmail(
  to: string,
  signInUrl: string,
): Promise<{ sent: boolean }> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) return { sent: false }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: LAUNCH_EMAIL_SUBJECT,
    text: launchEmailText(signInUrl),
    html: launchHtml(signInUrl),
  })
  return { sent: !error }
}

/**
 * Tell ONE admin a NEW email just joined the waitlist. Best-effort: callers wrap
 * this in try/catch so a Resend outage can never break the signup itself. Returns
 * { sent } so a caller can log the outcome without inspecting Resend internals.
 *
 * `to` defaults to the owner address; the waitlist notifier passes each opted-in
 * admin individually so recipients never see each other's addresses.
 */
export async function sendWaitlistSignupNotice(
  newEmail: string,
  totalCount: number,
  to: string = ADMIN_NOTIFY_TO,
): Promise<{ sent: boolean }> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) return { sent: false }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `New Souso waitlist signup: ${newEmail}`,
    text: `${newEmail} just joined the Souso waitlist. Total signups: ${totalCount}.`,
  })
  return { sent: !error }
}
