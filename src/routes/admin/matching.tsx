import { createFileRoute } from '@tanstack/react-router'
import { MatchingPanel } from '#/components/admin/MatchingPanel'

export const Route = createFileRoute('/admin/matching')({
  component: MatchingTab,
})

function MatchingTab() {
  return <MatchingPanel />
}
