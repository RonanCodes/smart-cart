import { Resend } from 'resend'
import { readEnv } from './env'

// Sends from the verified ronanconnolly.dev Resend account (the RESEND_API_KEY
// secret holds that key).
const FROM = 'Souso <hello@ronanconnolly.dev>'
const MASCOT = 'https://smartcart.ronanconnolly.dev/mascot-avatar.png'
const GREEN = '#43A047'
const CANVAS = '#FBFDF9'

function otpHtml(code: string): string {
  const spaced = code.split('').join('&nbsp;')
  return `
  <div style="background:${CANVAS};padding:32px 0;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e7eee7;border-radius:16px;overflow:hidden;">
      <div style="background:${GREEN};padding:20px 28px;text-align:center;">
        <img src="${MASCOT}" alt="Souso" width="64" height="64" style="display:inline-block;border-radius:12px;vertical-align:middle;" />
        <span style="color:#ffffff;font-size:20px;font-weight:700;vertical-align:middle;margin-left:10px;">Souso</span>
      </div>
      <div style="padding:32px 28px;text-align:center;">
        <p style="color:#5b6b5b;margin:0 0 20px;font-size:15px;">Your sign-in code:</p>
        <p style="font-size:38px;font-weight:800;letter-spacing:8px;color:#1f2a1f;margin:0 0 24px;">${spaced}</p>
        <p style="color:#8a988a;font-size:13px;line-height:1.5;margin:0;">It expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #f0f4f0;text-align:center;">
        <p style="color:#9aa89a;font-size:12px;margin:0;">Souso, your sous chef</p>
      </div>
    </div>
  </div>`
}

/**
 * Send the sign-in one-time code. Throws if Resend is unconfigured so the auth
 * flow surfaces a clear error rather than silently failing to deliver the code.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const apiKey = await readEnv('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set, cannot send the sign-in code.')
  }
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your Souso code: ${code}`,
    text: `Your Souso sign-in code is ${code}. It expires in 10 minutes.`,
    html: otpHtml(code),
  })
  if (error) {
    throw new Error(`Resend failed to send the sign-in code: ${error.message}`)
  }
}
