import { Check, Heart } from 'lucide-react'
import { cn } from '#/lib/utils'
import { Input } from '#/components/ui/input'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'
import { useOnboardingForm } from '../form-state'
import type { SignupSource } from '../form-state'

/**
 * AttributionStep — "How did you find us?" (penultimate profile step, right
 * before the beta step and the email/auth phase). Captures lightweight signup
 * attribution so we can see which channels actually bring people in.
 *
 * Two fields:
 *   - a single-select source (LinkedIn / TikTok / Instagram / Word of mouth /
 *     Other). Picking 'Other' reveals a free-text "Where did you find us?".
 *   - an always-shown optional "Anyone we should thank?" referrer free text (the
 *     person who shared it).
 *
 * The whole step is OPTIONAL: the shell's Next CTA never gates on it, so a user
 * can continue without answering. Picking a source fires the `signupSource`
 * funnel event (guarded, never throws); the values are persisted to the
 * signup_attribution table at onboarding-complete. A user who never picks a
 * source has no stored row, which reads downstream as "source unknown".
 *
 * Like the other steps, this only reads/patches the in-flight draft via
 * useOnboardingForm — persistence is owned by completeOnboarding.
 */

const SOURCE_OPTIONS: ReadonlyArray<{
  slug: Exclude<SignupSource, ''>
  label: string
}> = [
  { slug: 'linkedin', label: 'LinkedIn' },
  { slug: 'tiktok', label: 'TikTok' },
  { slug: 'instagram', label: 'Instagram' },
  { slug: 'word_of_mouth', label: 'Word of mouth' },
  { slug: 'other', label: 'Other' },
]

export function AttributionStep() {
  const { draft, patch } = useOnboardingForm()

  function pick(slug: Exclude<SignupSource, ''>) {
    patch({ source: slug })
    // Funnel event: which channel the user attributes the signup to. The
    // referrer/other free text rides along so the funnel can be split by it.
    // Guarded inside track(); never throws.
    track(FUNNEL_EVENTS.signupSource, {
      source: slug,
      sourceOther: slug === 'other' ? draft.sourceOther : '',
      referrer: draft.referrer,
    })
  }

  return (
    <div className="flex flex-col gap-5" data-testid="attribution-step">
      <div
        role="radiogroup"
        aria-label="How did you find us?"
        className="flex flex-col gap-3"
      >
        {SOURCE_OPTIONS.map((option) => {
          const isSelected = draft.source === option.slug
          return (
            <button
              key={option.slug}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={option.label}
              onClick={() => pick(option.slug)}
              className={cn(
                'flex items-center gap-4 rounded-[var(--radius-ios)] border p-4 text-left transition active:scale-[0.98]',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <span className="text-foreground flex-1 font-semibold">
                {option.label}
              </span>
              {isSelected ? (
                <Check aria-hidden className="text-primary h-6 w-6 shrink-0" />
              ) : null}
            </button>
          )
        })}
      </div>

      {draft.source === 'other' && (
        <div className="space-y-2">
          <label
            htmlFor="attribution-source-other"
            className="text-sm font-semibold"
          >
            Where did you find us?
          </label>
          <Input
            id="attribution-source-other"
            data-testid="attribution-source-other"
            type="text"
            placeholder="Tell us where"
            value={draft.sourceOther}
            onChange={(e) => patch({ sourceOther: e.target.value })}
            className="h-12 rounded-full text-base"
          />
        </div>
      )}

      <div className="space-y-2">
        <label
          htmlFor="attribution-referrer"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <Heart className="text-primary h-4 w-4" aria-hidden />
          Anyone we should thank?{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <p className="text-muted-foreground text-xs">
          The person who shared it, e.g. Ronan or TJ.
        </p>
        <Input
          id="attribution-referrer"
          data-testid="attribution-referrer"
          type="text"
          placeholder="the person who shared it, e.g. Ronan or TJ"
          value={draft.referrer}
          onChange={(e) => patch({ referrer: e.target.value })}
          className="h-12 rounded-full text-base"
        />
      </div>
    </div>
  )
}
