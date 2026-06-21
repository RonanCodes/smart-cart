import { Bell, BellOff, Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { usePushSubscription } from '#/components/push/use-push-subscription'

/**
 * RETIRED from the active onboarding flow (#149 prompt-on-auth). It is no longer
 * listed in `STEPS`, so notifications are no longer asked mid-form. The push
 * permission prompt now fires immediately on a successful sign-in / sign-up (a
 * user-gesture moment) via `promptForNotifications()` in push-client.ts. This
 * component is kept only for reference / potential reuse and is not imported
 * anywhere; delete it if it stays unused.
 *
 * NotificationsStep — the (former) optional 'Stay in the loop' screen of the
 * Jow-style onboarding (#204). Asked for notification permission while the user
 * was engaged, which lifted opt-in vs the buried Week-page control
 * (RatingReminders).
 *
 * It NEVER blocks onboarding. The shell's bottom CTA ('Build my week') always
 * advances regardless of what happens here, so a skip is simply tapping that CTA.
 * Enabling is a bonus, not a gate. Where push can't work (unsupported / unconfigured
 * / denied / browser-blocked) we show a calm 'notifications aren't available here'
 * note and let the user carry on to generate their week.
 *
 * Subscribe logic is the shared `usePushSubscription` hook, so this and the Week
 * control can't drift. Mobile-first at 390px: one big tap target, iOS styling, calm
 * copy.
 */
export function NotificationsStep() {
  const { state, enable } = usePushSubscription()

  const unavailable =
    state === 'unsupported' || state === 'unconfigured' || state === 'denied'
  const subscribed = state === 'subscribed'

  return (
    <div className="flex flex-col gap-5" data-testid="notifications-step">
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-[var(--radius-ios)] border px-6 py-8 text-center">
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
            {subscribed ? "You're all set" : 'A gentle nudge to rate dinner'}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {subscribed
              ? "We'll send a quiet reminder after you cook, so Souso keeps learning your taste."
              : unavailable
                ? "Notifications aren't available here, no problem. You can turn them on later from your week."
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
            data-testid="notifications-enable"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {state === 'subscribing' ? 'Enabling…' : 'Enable notifications'}
          </Button>
        )}

        {state === 'error' && (
          <p className="text-muted-foreground text-xs">
            Couldn&apos;t enable that just now. You can try again from your
            week.
          </p>
        )}
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Optional. Tap &lsquo;Build my week&rsquo; to continue either way.
      </p>
    </div>
  )
}
