import { createFileRoute, redirect } from '@tanstack/react-router'

/** /admin defaults to the Users tab. */
export const Route = createFileRoute('/admin/')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/users' })
  },
})
