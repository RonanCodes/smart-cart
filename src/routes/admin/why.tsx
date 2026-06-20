import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listUsers } from '#/lib/admin-server'
import { WhyPanel } from '#/components/admin/WhyPanel'
import { WhySkeleton } from '#/components/admin/AdminSkeletons'

async function loadWhyUsers() {
  return { users: await listUsers() }
}

export const Route = createFileRoute('/admin/why')({
  loader: loadWhyUsers,
  // Skeleton while the loader resolves (#231); SSR-hydrated first paint is
  // untouched, this only shows on client tab switches + slow reads.
  pendingComponent: WhySkeleton,
  component: WhyTab,
})

function WhyTab() {
  const loaderData = Route.useLoaderData()
  // Cache the user list under the shared QueryClient (#230), seeded from the
  // loader so first paint stays SSR and tab revisits are instant.
  const { data } = useQuery({
    queryKey: ['admin', 'why', 'users'],
    queryFn: loadWhyUsers,
    initialData: loaderData,
  })
  return <WhyPanel users={data.users} />
}
