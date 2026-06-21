import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getLaunchEmailPreview } from '#/lib/launch-server'
import { EmailBroadcastPanel } from '#/components/admin/EmailBroadcastPanel'

export const Route = createFileRoute('/admin/email')({
  loader: () => getLaunchEmailPreview(),
  component: EmailTab,
})

function EmailTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'email-preview'],
    queryFn: () => getLaunchEmailPreview(),
    initialData: loaderData,
  })
  return <EmailBroadcastPanel preview={data} />
}
