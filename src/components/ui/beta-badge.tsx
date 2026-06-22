import { cn } from '#/lib/utils'
import { BETA_LABEL } from '#/lib/beta'

/**
 * BetaBadge — a small, on-brand "Beta" tag in the mustard accent. Sits next to
 * the Souso wordmark (landing, onboarding welcome) and in the signed-in app
 * chrome (ScreenHeader) so users always know they're on a beta build (#407).
 * It is purely informational, not a gate.
 */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'bg-accent text-accent-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase',
        className,
      )}
    >
      {BETA_LABEL}
    </span>
  )
}
