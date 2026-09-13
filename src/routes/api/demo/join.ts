import { createFileRoute } from '@tanstack/react-router'

/**
 * POST /api/demo/join — the PUBLIC join endpoint behind the QR code.
 *
 * Takes `{ phone }`, normalises it, and adds it to the in-memory roulette
 * Durable Object (NOT a database). Returns only `{ ok, count }` — never echoes
 * the number back. The number is held in memory for the length of the pitch and
 * is never persisted or logged (see DemoRouletteRoom for the privacy contract).
 */
export const Route = createFileRoute('/api/demo/join')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            phone?: unknown
          }
          const raw = typeof body.phone === 'string' ? body.phone : ''

          const { normalisePhone } = await import('#/lib/demo-phone')
          const normalised = normalisePhone(raw)
          if (!normalised) {
            return Response.json(
              { ok: false, error: 'That does not look like a phone number.' },
              { status: 400 },
            )
          }

          const { addEntrant } = await import('#/lib/demo-roulette-server')
          const count = await addEntrant(normalised)
          // Note: we log the count only, never the number.
          return Response.json({ ok: true, count })
        } catch (err) {
          const { log } = await import('#/lib/log')
          log.error('demo.join_failed', err)
          return Response.json(
            { ok: false, error: 'Could not join the draw.' },
            { status: 500 },
          )
        }
      },
    },
  },
})
