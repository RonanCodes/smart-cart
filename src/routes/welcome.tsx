import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '#/components/marketing/Landing'

/**
 * /welcome: temporary mount point for the marketing Landing so it can be
 * reviewed without touching index.tsx (owned by another worker / #105). The
 * final swap of / to Landing is a separate follow-up after #105 lands.
 */
export const Route = createFileRoute('/welcome')({ component: Welcome })

function Welcome() {
  return <Landing />
}
