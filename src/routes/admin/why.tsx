import { createFileRoute } from '@tanstack/react-router'
import { listUsers } from '#/lib/admin-server'
import { WhyPanel } from '#/components/admin/WhyPanel'

export const Route = createFileRoute('/admin/why')({
  loader: async () => ({ users: await listUsers() }),
  component: WhyTab,
})

function WhyTab() {
  const { users } = Route.useLoaderData()
  return <WhyPanel users={users} />
}
