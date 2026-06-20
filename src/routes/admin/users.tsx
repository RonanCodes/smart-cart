import { createFileRoute } from '@tanstack/react-router'
import { listUsers } from '#/lib/admin-server'
import { UsersPanel } from '#/components/admin/UsersPanel'

export const Route = createFileRoute('/admin/users')({
  loader: async () => ({ users: await listUsers() }),
  component: UsersTab,
})

function UsersTab() {
  const { users } = Route.useLoaderData()
  return <UsersPanel users={users} />
}
