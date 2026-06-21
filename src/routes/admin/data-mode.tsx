import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getDataModeSettings } from '#/lib/data-mode-server'
import { listUsers } from '#/lib/admin-server'
import { DataModePanel } from '#/components/admin/DataModePanel'
import { PaymentsSkeleton } from '#/components/admin/AdminSkeletons'

async function loadDataMode() {
  // Settings carry the global default + existing overrides; listUsers gives every
  // household so the admin can ADD an override for one with none yet. Both
  // admin-gated server-side.
  const [settings, users] = await Promise.all([
    getDataModeSettings(),
    listUsers(),
  ])
  return { settings, users }
}

export const Route = createFileRoute('/admin/data-mode')({
  loader: loadDataMode,
  // Reuse the payments skeleton: the layout (a global toggle + a per-household
  // list) is the same shape.
  pendingComponent: PaymentsSkeleton,
  component: DataModeTab,
})

function DataModeTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'data-mode'],
    queryFn: loadDataMode,
    initialData: loaderData,
  })
  return <DataModePanel settings={data.settings} users={data.users} />
}
