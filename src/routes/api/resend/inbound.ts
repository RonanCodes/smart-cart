import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/resend/inbound — the Resend inbound-email webhook (#457).
 *
 * Receiving is enabled on souso.app (the owner adds the inbound MX in Cloudflare
 * + points Resend's inbound webhook here). When someone emails hello@souso.app,
 * Resend POSTs an inbound event (`email.received` / `inbound.email`) carrying
 * from/to/subject/text/html. We verify the Svix-style signature, then forward
 * the message to every admin so the team sees it without a shared mailbox.
 *
 * Hard rules (Resend webhook contract + Souso security):
 * - Verify the Svix signature (svix-id / svix-timestamp / svix-signature) against
 *   RESEND_WEBHOOK_SECRET, timing-safe. Fail CLOSED (401) when a secret IS set
 *   and the signature is invalid. When NO secret is set, log a warn + accept, so
 *   the webhook works before the secret is wired (mirrors the VAPI webhook).
 * - Forwarding is best-effort and NEVER throws. ALWAYS return 200 on a verified
 *   event, even if every forward fails (Resend retries non-2xx; we don't want a
 *   forward outage to make it hammer us, and observability must never crash a
 *   request).
 *
 * The crypto + parsing live in src/lib/resend-webhook.ts (unit-tested); the send
 * lives in src/lib/email.ts. Both are dynamically imported so cloudflare:workers
 * never leaks into the client bundle.
 */
export const Route = createFileRoute('/api/resend/inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { log } = await import('../../../lib/log')
        try {
          const { readEnv } = await import('../../../lib/env')
          const { verifyResendSignature, parseInboundEmail } =
            await import('../../../lib/resend-webhook')

          // Read the RAW body once: the signature is over the exact bytes, so we
          // must not re-serialise a parsed object.
          const rawBody = await request.text()
          const secret = (await readEnv('RESEND_WEBHOOK_SECRET')) ?? ''
          const verify = await verifyResendSignature(
            secret,
            {
              svixId: request.headers.get('svix-id'),
              svixTimestamp: request.headers.get('svix-timestamp'),
              svixSignature: request.headers.get('svix-signature'),
            },
            rawBody,
          )

          if (!verify.verified) {
            log.warn('resend.inbound.unauthorized', {
              reason: verify.reason,
              hint: 'svix signature did not verify; check RESEND_WEBHOOK_SECRET matches the Resend webhook signing secret',
            })
            return new Response('unauthorized', { status: 401 })
          }
          if (verify.reason === 'no_secret') {
            // Accept-but-warn: the webhook works before the secret is wired, but
            // the gap is visible so it gets closed.
            log.warn('resend.inbound.no_secret', {
              hint: 'RESEND_WEBHOOK_SECRET is not set — accepting unverified. Set the Worker secret to enforce verification.',
            })
          }

          const body: unknown = (() => {
            try {
              return JSON.parse(rawBody)
            } catch {
              return null
            }
          })()
          const inbound = parseInboundEmail(body)
          if (!inbound) {
            // A verified but non-inbound event (or unparseable). Ack it; nothing
            // to forward.
            log.info('resend.inbound.skipped', {
              type:
                body && typeof body === 'object'
                  ? (body as { type?: unknown }).type
                  : null,
            })
            return new Response('ok', { status: 200 })
          }

          const { resolveAdminEmails } =
            await import('../../../lib/admin-emails')
          const { forwardInboundEmail } = await import('../../../lib/email')
          const admins = await resolveAdminEmails()

          const results = await Promise.all(
            admins.map(async (to) => {
              try {
                const { sent } = await forwardInboundEmail(inbound, to)
                return sent
              } catch (err) {
                log.error('resend.inbound.forward_failed', err, { to })
                return false
              }
            }),
          )
          log.info('resend.inbound.forwarded', {
            from: inbound.from,
            subject: inbound.subject,
            admins: admins.length,
            delivered: results.filter(Boolean).length,
          })

          return new Response('ok', { status: 200 })
        } catch (err) {
          // Never throw out of the webhook. We still 200 on an unexpected error
          // so Resend doesn't retry-storm; the error is logged for diagnosis.
          log.error('resend.inbound.webhook_failed', err)
          return new Response('ok', { status: 200 })
        }
      },
    },
  },
})
