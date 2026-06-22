import { Sparkles, Phone } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { useOnboardingForm } from '../form-state'
import type { ContactPref } from '../form-state'

/** How the tester would prefer we reach out, when they leave a number. */
const CONTACT_PREFS: Array<{ value: ContactPref; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'either', label: 'Either' },
]

/**
 * BetaStep — the LAST onboarding step before the email/auth phase (#407). Frames
 * joining Souso as becoming a beta tester (a mental commitment to give feedback,
 * NOT a gate, the shell's "Next" CTA just advances), points to the always-on
 * Feedback button, and OPTIONALLY captures a phone/WhatsApp + a contact
 * preference for testers happy to be reached out to. Nothing here is required.
 */
export function BetaStep() {
  const { draft, patch } = useOnboardingForm()
  const hasPhone = (draft.phone ?? '').trim().length > 0
  return (
    <div className="flex flex-col gap-5" data-testid="beta-step">
      {/* Clean card (was a hard-to-read peachy tint): white surface, green
          accent, on-brand and legible. */}
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
          (bottom-right) any time.
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
          Leave your number and we will reach out to see how it is going. You
          would be improving Souso directly, for you.
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

        {/* Contact preference, shown once they start leaving a number. */}
        {hasPhone && (
          <div className="pt-1">
            <p className="text-muted-foreground mb-1.5 text-xs">
              Best way to reach you?
            </p>
            <div
              className="flex gap-2"
              role="group"
              aria-label="Contact preference"
            >
              {CONTACT_PREFS.map((opt) => {
                const selected = draft.contactPref === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      patch({ contactPref: selected ? null : opt.value })
                    }
                    className={cn(
                      'flex-1 rounded-full border px-3 py-2 text-sm font-medium transition active:scale-95',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
