import { createFileRoute } from '@tanstack/react-router'
import { checkDbHealth } from '../../db/client'

/** Liveness + DB probe. Always 200; reports DB state in the body. */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const db = await checkDbHealth()
        return Response.json({ ok: true, db, ts: new Date().toISOString() })
      },
    },
  },
})
