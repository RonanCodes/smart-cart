import { Bell, BellOff, Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { usePushSubscription } from '#/components/push/use-push-subscription'

/**
 * Opt-in control for post-meal rating reminders (#149). Asks the browser for
 * Notification permission, subscribes to push against the VAPID public key, and
 * registers the subscription server-side so an admin can later send a "rate the
 * meal" push. Fully guarded: renders nothing on browsers without push, and shows
 * a clear "not set up yet" line when VAPID secrets are unset on the server.
 *
 * The subscribe flow lives in the shared `usePushSubscription` hook (#204), so the
 * onboarding opt-in and this Week control share one implementation. This component
 * is just the Week-page presentation: a single 44px tap target, plain status text.
 *
 * Mobile-first: no hover-only affordance, status text underneath so the user always
 * knows where they stand.
 */
export function RatingReminders() {
  const { state, enable, disable } = usePushSubscription()

  // Nothing to show where push can't work or isn't set up: keep the week clean.
  if (
    state === 'checking' ||
    state === 'unsupported' ||
    state === 'unconfigured'
  ) {
    return null
  }

  return (
    <div className="border-border/60 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Rating reminders</p>
        <p className="text-muted-foreground text-xs">
          {state === 'subscribed'
            ? "We'll nudge you to rate a dinner after you cook it."
            : state === 'denied'
              ? 'Notifications are blocked. Enable them in your browser settings.'
              : state === 'error'
                ? "Couldn't enable reminders, try again."
                : 'Get a gentle nudge to rate a meal after you cook it.'}
        </p>
      </div>
      {state === 'subscribed' ? (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => void disable()}
          aria-label="Turn off rating reminders"
        >
          <Check className="text-primary h-4 w-4" aria-hidden />
          On · Turn off
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={state === 'subscribing' || state === 'denied'}
          onClick={() => void enable()}
        >
          {state === 'denied' ? (
            <BellOff className="h-4 w-4" aria-hidden />
          ) : (
            <Bell className="h-4 w-4" aria-hidden />
          )}
          {state === 'subscribing' ? 'Enabling…' : 'Enable'}
        </Button>
      )}
    </div>
  )
}
