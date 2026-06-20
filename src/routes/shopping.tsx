import { createFileRoute, Link } from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/shopping')({ component: Shopping })

/**
 * Shopping tab — placeholder for the filled basket (AH / Jumbo) view. Stubbed so
 * the tab bar has a real destination; the basket lands in a later slice.
 */
function Shopping() {
  return (
    <AppShell>
      <ScreenHeader
        title="Shopping"
        subtitle="Your week, turned into one ready-to-order basket."
      />
      <EmptyState
        icon={<ShoppingBag aria-hidden />}
        title="No basket yet"
        hint="Plan a week and Souso fills a basket at Albert Heijn or Jumbo, ready for you to check out."
        action={
          <Link to="/week">
            <Button size="pill">Plan my week</Button>
          </Link>
        }
      />
    </AppShell>
  )
}
