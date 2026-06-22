import { Sparkles, Phone } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { useOnboardingForm } from '../form-state'

/**
 * BetaStep — the LAST onboarding step before the email/auth phase (#407). Frames
 * joining Souso as becoming a beta tester (a mental commitment to give feedback,
 * NOT a gate, the shell's "Next" CTA just advances), points to the always-on
 * Feedback button, and OPTIONALLY captures a phone/WhatsApp number for testers
 * happy to be reached out to. Just a number (WhatsApp and phone are the same
 * thing, so there's no separate channel preference). Nothing here is required.
 */
export function BetaStep() {
  const { draft, patch } = useOnboardingForm()
  return (
    <div className="flex flex-col gap-5" data-testid="beta-step">
      {/* Clean card: white surface, green accent, on-brand and legible. */}
      <div className="border-border bg-card rounded-2xl border p-4 shadow-sm">
        <div className="text-primary flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="text-primary h-4 w-4" aria-hidden />
          You&rsquo;re one of our first beta testers
        </div>
        <p className="text-foreground/80 mt-2 text-sm leading-relaxed">
          Souso is brand new, so you will spot rough edges. That is the point:
          your feedback is what shapes it. Tell us what you love and what
          breaks, and we will build it around you.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Spot something? Tap the{' '}
          <span className="text-foreground font-semibold">Feedback</span> button
          in the middle of the bottom bar any time.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="beta-phone"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <Phone className="text-primary h-4 w-4" aria-hidden />
          Up for a quick chat?{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <p className="text-muted-foreground text-xs">
          Leave your number (phone or WhatsApp) and we will reach out to see how
          it is going. You would be improving Souso directly, for you.
        </p>
        <Input
          id="beta-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+31 6 12345678"
          value={draft.phone ?? ''}
          onChange={(e) => patch({ phone: e.target.value })}
          className="h-12 rounded-full text-base"
        />
      </div>
    </div>
  )
}
