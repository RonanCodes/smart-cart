import { createFileRoute } from '@tanstack/react-router'
import { listWaitlist } from '#/lib/admin-server'
import { getMyWaitlistNotify } from '#/lib/admin-prefs-server'
import { WaitlistPanel } from '#/components/admin/WaitlistPanel'

export const Route = createFileRoute('/admin/waitlist')({
  loader: async () => ({
    waitlist: await listWaitlist(),
    myWaitlistNotify: await getMyWaitlistNotify(),
  }),
  component: WaitlistTab,
})

function WaitlistTab() {
  const { waitlist, myWaitlistNotify } = Route.useLoaderData()
  return <WaitlistPanel waitlist={waitlist} notifyEnabled={myWaitlistNotify} />
}
