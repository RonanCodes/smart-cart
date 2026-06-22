import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getLaunchEmailPreview } from '#/lib/launch-server'
import { isSuperAdmin } from '#/lib/admin-server'
import { EmailBroadcastPanel } from '#/components/admin/EmailBroadcastPanel'

export const Route = createFileRoute('/admin/email')({
  loader: async () => ({
    preview: await getLaunchEmailPreview(),
    // Server-decided: the launch-email broadcast is super-admin-only, so a
    // regular admin sees it disabled. The server fn is the real guard.
    canSend: await isSuperAdmin(),
  }),
  component: EmailTab,
})

function EmailTab() {
  const loaderData = Route.useLoaderData()
  const { data } = useQuery({
    queryKey: ['admin', 'email-preview'],
    queryFn: () => getLaunchEmailPreview(),
    initialData: loaderData.preview,
  })
  return <EmailBroadcastPanel preview={data} canSend={loaderData.canSend} />
}
