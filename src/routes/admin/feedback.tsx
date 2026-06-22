import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { listRealFeedbackHouseholds } from '#/lib/admin-server'
import { listAppFeedback } from '#/lib/app-feedback-server'
import { listSentryFeedback } from '#/lib/sentry-admin-server'
import { listInboundEmails } from '#/lib/inbound-email-server'
import { RealFeedbackPanel } from '#/components/admin/RealFeedbackPanel'
import { AppFeedbackInbox } from '#/components/admin/AppFeedbackInbox'
import { SentryFeedbackPanel } from '#/components/admin/SentryFeedbackPanel'
import { InboundEmailPanel } from '#/components/admin/InboundEmailPanel'
import { FeedbackSkeleton } from '#/components/admin/AdminSkeletons'

async function loadRealFeedback() {
  // The Sentry + Resend reads degrade gracefully (never throw), so a slow/failed
  // external API can't break the tab — Promise.all stays safe.
  const [realFeedbackHouseholds, appFeedback, sentryFeedback, inboundEmails] =
    await Promise.all([
      listRealFeedbackHouseholds(),
      listAppFeedback(),
      listSentryFeedback(),
      listInboundEmails(),
    ])
  return { realFeedbackHouseholds, appFeedback, sentryFeedback, inboundEmails }
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
  return (
    <div className="space-y-8">
      <AppFeedbackInbox items={data.appFeedback} />
      <SentryFeedbackPanel data={data.sentryFeedback} />
      <InboundEmailPanel data={data.inboundEmails} />
      <RealFeedbackPanel households={data.realFeedbackHouseholds} />
    </div>
  )
}
