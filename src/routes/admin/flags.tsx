import { createFileRoute } from '@tanstack/react-router'
import { getFlags } from '#/lib/flags-server'
import { FlagsPanel } from '#/components/admin/FlagsPanel'

/**
 * /admin/flags — the feature-flag toggle panel. The loader reads the current
 * flags (ungated; the writes inside FlagsPanel are admin-gated server-side).
 * Flags are scoped to this environment's D1, so this toggles dev on dev.souso.app
 * and prod on souso.app independently.
 */
export const Route = createFileRoute('/admin/flags')({
  loader: async () => ({ flags: await getFlags() }),
  component: FlagsTab,
})

function FlagsTab() {
  const { flags } = Route.useLoaderData()
  return <FlagsPanel initial={flags} />
}
