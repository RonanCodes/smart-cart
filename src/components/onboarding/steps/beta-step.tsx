import { Sparkles, Phone } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { useOnboardingForm } from '../form-state'

/**
 * BetaStep — the first onboarding screen (#407). Frames joining Souso as becoming
 * a beta tester: a mental commitment to give feedback (NOT a gate, the shell's
 * "Next" CTA just advances), a pointer to the always-on Feedback button, and an
 * OPTIONAL phone/WhatsApp for testers happy to be reached out to for a chat.
 * Nothing here is required.
 */
export function BetaStep() {
  const { draft, patch } = useOnboardingForm()
  return (
    <div className="flex flex-col gap-5" data-testid="beta-step">
      <div className="border-accent/40 bg-accent/15 rounded-2xl border p-4">
        <div className="text-primary flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="text-accent h-4 w-4" aria-hidden />
          You&rsquo;re one of our first beta testers
        </div>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          Souso is brand new, so you will spot rough edges. That is the point:
          your feedback is what shapes it. Tell us what you love and what
          breaks, and we will build it around you.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Spot something? Tap the{' '}
          <span className="text-foreground font-semibold">Feedback</span> button
          (bottom-right) any time.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="beta-phone"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <Phone className="text-accent h-4 w-4" aria-hidden />
          Up for a quick chat?{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <p className="text-muted-foreground text-xs">
          Leave your number or WhatsApp and we may reach out to hear how it is
          going. You would be improving Souso directly, for you.
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
