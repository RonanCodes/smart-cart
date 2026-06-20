import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listRealFeedbackHouseholds } from '#/lib/admin-server'
import { RealFeedbackPanel } from '#/components/admin/RealFeedbackPanel'
import { FeedbackSkeleton } from '#/components/admin/AdminSkeletons'

async function loadRealFeedback() {
  return { realFeedbackHouseholds: await listRealFeedbackHouseholds() }
}

export const Route = createFileRoute('/admin/feedback')({
  loader: loadRealFeedback,
  // Skeleton while the loader resolves (#231); SSR-hydrated first paint is
  // untouched, this only shows on client tab switches + slow reads.
  pendingComponent: FeedbackSkeleton,
  component: FeedbackTab,
})

function FeedbackTab() {
  const loaderData = Route.useLoaderData()
  // Cache the households read under the shared QueryClient (#230), seeded from
  // the loader so first paint stays SSR and tab revisits are instant.
  const { data } = useQuery({
    queryKey: ['admin', 'feedback', 'households'],
    queryFn: loadRealFeedback,
    initialData: loaderData,
  })
  return <RealFeedbackPanel households={data.realFeedbackHouseholds} />
}
