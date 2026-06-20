import { Bell, BellOff, Check } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { usePushSubscription } from '#/components/push/use-push-subscription'

/**
 * NotificationsSheet — the Profile-tab entry to the push opt-in (#212). A bottom
 * sheet wrapping the SAME `usePushSubscription` flow the onboarding step and the
 * Week control use (#204), so all three surfaces share one subscribe path and
 * can't drift.
 *
 * It reflects the hook's state plainly:
 *  - subscribed -> a calm "you're set" with a check.
 *  - idle / error -> an Enable control that runs the permission + subscribe flow.
 *  - unsupported / unconfigured / denied -> a quiet "notifications aren't
 *    available here" note (covers Brave + browsers that block push), never a
 *    dead-end or an error shout.
 *
 * Mobile-first at 390px: one full-width tap target, iOS sheet styling, calm copy.
 */
export function NotificationsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, enable } = usePushSubscription()

  const unavailable =
    state === 'unsupported' || state === 'unconfigured' || state === 'denied'
  const subscribed = state === 'subscribed'

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Notifications">
      <div className="flex flex-col items-center gap-4 pt-2 pb-4 text-center">
        <span
          aria-hidden
          className={
            subscribed
              ? 'bg-primary/10 text-primary flex h-16 w-16 items-center justify-center rounded-full'
              : 'bg-secondary text-foreground flex h-16 w-16 items-center justify-center rounded-full'
          }
        >
          {subscribed ? (
            <Check className="h-8 w-8" />
          ) : unavailable ? (
            <BellOff className="h-8 w-8" />
          ) : (
            <Bell className="h-8 w-8" />
          )}
        </span>

        <div className="space-y-1">
          <p className="text-base font-semibold">
            {subscribed
              ? "You're all set"
              : unavailable
                ? 'Notifications not available here'
                : 'A gentle nudge to rate dinner'}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {subscribed
              ? "We'll send a quiet reminder after you cook, so Souso keeps learning your taste."
              : unavailable
                ? "This browser can't show notifications, no problem. Everything else works the same."
                : 'Get a nudge to rate your dinners so Souso learns your taste. No spam, just the meals you cooked.'}
          </p>
        </div>

        {!subscribed && !unavailable && (
          <Button
            size="pill"
            variant="outline"
            className="w-full"
            disabled={state === 'subscribing' || state === 'checking'}
            onClick={() => void enable()}
            data-testid="profile-notifications-enable"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {state === 'subscribing' ? 'Enabling…' : 'Enable notifications'}
          </Button>
        )}
      </div>
    </Sheet>
  )
}
