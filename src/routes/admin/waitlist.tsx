import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listWaitlist } from '#/lib/admin-server'
import { getMyWaitlistNotify } from '#/lib/admin-prefs-server'
import { WaitlistPanel } from '#/components/admin/WaitlistPanel'
import { WaitlistSkeleton } from '#/components/admin/AdminSkeletons'

async function loadWaitlist() {
  const [waitlist, myWaitlistNotify] = await Promise.all([
    listWaitlist(),
    getMyWaitlistNotify(),
  ])
  return { waitlist, myWaitlistNotify }
}

export const Route = createFileRoute('/admin/waitlist')({
  loader: loadWaitlist,
  // Skeleton while the loader resolves (#231); SSR-hydrated first paint is
  // untouched, this only shows on client tab switches + slow reads.
  pendingComponent: WaitlistSkeleton,
  component: WaitlistTab,
})

function WaitlistTab() {
  const loaderData = Route.useLoaderData()
  // Cache the waitlist + my-notify read under the shared QueryClient (#230),
  // seeded from the loader so first paint stays SSR and tab revisits are
  // instant.
  const { data } = useQuery({
    queryKey: ['admin', 'waitlist'],
    queryFn: loadWaitlist,
    initialData: loaderData,
  })
  return (
    <WaitlistPanel
      waitlist={data.waitlist}
      notifyEnabled={data.myWaitlistNotify}
    />
  )
}
