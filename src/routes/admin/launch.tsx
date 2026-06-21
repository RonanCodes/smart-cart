import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getLaunchState } from '#/lib/launch-server'
import { LaunchPanel } from '#/components/admin/LaunchPanel'

export const Route = createFileRoute('/admin/launch')({
  loader: () => getLaunchState(),
  component: LaunchTab,
})

function LaunchTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'launch'],
    queryFn: () => getLaunchState(),
    initialData: loaderData,
  })
  return <LaunchPanel state={data} />
}
