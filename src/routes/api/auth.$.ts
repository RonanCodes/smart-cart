import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '../../lib/auth'

/** Better Auth catch-all handler, mounted at /api/auth/*. */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuth()
        return auth.handler(request)
      },
      POST: async ({ request }) => {
        const auth = await getAuth()
        return auth.handler(request)
      },
    },
  },
})
