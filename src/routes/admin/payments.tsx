import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getPaymentModeSettings } from '#/lib/payment-mode-server'
import { listUsers } from '#/lib/admin-server'
import { PaymentsPanel } from '#/components/admin/PaymentsPanel'
import { PaymentsSkeleton } from '#/components/admin/AdminSkeletons'

async function loadPayments() {
  // Settings carry the global default + the existing overrides; listUsers gives
  // every household so the admin can ADD an override for a household that has
  // none yet. Both admin-gated server-side.
  const [settings, users] = await Promise.all([
    getPaymentModeSettings(),
    listUsers(),
  ])
  return { settings, users }
}

export const Route = createFileRoute('/admin/payments')({
  loader: loadPayments,
  // Skeleton while the loader resolves (#231); SSR-hydrated first paint is
  // untouched, this only shows on client tab switches + slow reads.
  pendingComponent: PaymentsSkeleton,
  component: PaymentsTab,
})

function PaymentsTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'payments'],
    queryFn: loadPayments,
    initialData: loaderData,
  })
  return <PaymentsPanel settings={data.settings} users={data.users} />
}
