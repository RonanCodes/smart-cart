import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getLaunchState } from '#/lib/launch-server'
import { isSuperAdmin } from '#/lib/admin-server'
import { LaunchPanel } from '#/components/admin/LaunchPanel'

export const Route = createFileRoute('/admin/launch')({
  loader: async () => ({
    state: await getLaunchState(),
    // Server-decided: the launch toggle is super-admin-only, so a regular admin
    // sees it disabled. The server fn is the real guard; this is courtesy.
    canLaunch: await isSuperAdmin(),
  }),
  component: LaunchTab,
})

function LaunchTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'launch'],
    queryFn: () => getLaunchState(),
    initialData: loaderData.state,
  })
  return <LaunchPanel state={data} canLaunch={loaderData.canLaunch} />
}
