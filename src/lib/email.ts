import { Resend } from 'resend'
import { readEnv } from './env'

// Sends from the verified simplicitylabs.io domain (the only verified Resend
// sender available today). Swap to a verified smartcart.ronanconnolly.dev address
// once that domain is added in Resend.
const FROM = 'Smart Cart <hello@simplicitylabs.io>'

/**
 * Send the sign-in one-time code. Throws if Resend is unconfigured so the auth
 * flow surfaces a clear error rather than silently failing to deliver the code.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set — cannot send the sign-in code.')
  }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your Smart Cart code: ${code}`,
    text: `Your Smart Cart sign-in code is ${code}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 20px; margin: 0 0 8px;">Smart Cart</h1>
        <p style="color: #555; margin: 0 0 24px;">Your sign-in code:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 0 0 24px;">${code}</p>
        <p style="color: #888; font-size: 13px;">It expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>`,
  })
  if (error) {
    throw new Error(`Resend failed to send the sign-in code: ${error.message}`)
  }
}
