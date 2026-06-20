import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listUsers } from '#/lib/admin-server'
import { UsersPanel } from '#/components/admin/UsersPanel'
import { UsersSkeleton } from '#/components/admin/AdminSkeletons'

async function loadUsers() {
  return { users: await listUsers() }
}

export const Route = createFileRoute('/admin/users')({
  loader: loadUsers,
  // Skeleton while the loader resolves (#231). The loader still runs on the
  // server and hydrates first paint (SSR untouched); the skeleton only shows on
  // client-side tab switches and slow reads.
  pendingComponent: UsersSkeleton,
  component: UsersTab,
})

function UsersTab() {
  const loaderData = Route.useLoaderData()
  // Cache the users read under the shared QueryClient (#230) so flicking back to
  // this tab is instant with no refetch. The loader's server-rendered result
  // seeds the cache as initialData, so first paint stays SSR; the query only
  // refetches in the background once it goes stale (30s).
  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: loadUsers,
    initialData: loaderData,
  })
  return <UsersPanel users={data.users} />
}
