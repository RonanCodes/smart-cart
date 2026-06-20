import { createFileRoute } from '@tanstack/react-router'
import { listRealFeedbackHouseholds } from '#/lib/admin-server'
import { RealFeedbackPanel } from '#/components/admin/RealFeedbackPanel'

export const Route = createFileRoute('/admin/feedback')({
  loader: async () => ({
    realFeedbackHouseholds: await listRealFeedbackHouseholds(),
  }),
  component: FeedbackTab,
})

function FeedbackTab() {
  const { realFeedbackHouseholds } = Route.useLoaderData()
  return <RealFeedbackPanel households={realFeedbackHouseholds} />
}
