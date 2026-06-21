import { cn } from '#/lib/utils'
import { BETA_LABEL } from '#/lib/beta'

/**
 * BetaBadge — a small, SUBTLE "Beta" tag (#407). The owner's brief: it should be
 * present on every page but quiet and hovering, "not in your face", and it must
 * never shove the centered Souso wordmark off-centre.
 *
 * So it is a muted, low-contrast pill (a soft mustard tint with a hairline
 * mustard border, not the old solid-mustard fill) that reads as a gentle aside,
 * in the same warm spirit as the home-page sticky-note tagline. Use it tucked
 * under or beside the wordmark, or pinned to a corner — small enough to whisper
 * "beta" without competing with the brand.
 *
 * Purely informational, not a gate.
 */
export function BetaBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // Muted mustard tint + hairline border, low-contrast text. Small + quiet.
        'border-accent/40 bg-accent/10 text-foreground/60 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.5625rem] font-medium tracking-wider uppercase',
        className,
      )}
    >
      {BETA_LABEL}
    </span>
  )
}
