import { createFileRoute, Link } from '@tanstack/react-router'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'

/**
 * Landing page after the Mollie hosted-checkout redirect for a tip
 * (redirectUrl = /tip/{id}/return). The actual paid/failed status is settled by
 * the Mollie webhook (re-fetched from the API), so this page is just a warm
 * acknowledgement, never a status source. Reward-not-guilt (#18): thank, don't
 * dwell on outcome.
 */
export const Route = createFileRoute('/tip/$id/return')({
  component: TipReturn,
})

function TipReturn() {
  return (
    <AppShell>
      <ScreenHeader title="Thanks!" />
      <div className="flex flex-col items-center gap-4 px-5 pt-10 text-center">
        <div className="text-6xl" aria-hidden>
          🥳
        </div>
        <p className="text-sm font-medium">Thanks for supporting Souso!</p>
        <p className="text-muted-foreground text-xs">
          Your cart is ready in your store. Happy cooking.
        </p>
        <Link to="/shopping">
          <Button size="pill">Back to shopping</Button>
        </Link>
      </div>
    </AppShell>
  )
}
