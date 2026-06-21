import { Check } from 'lucide-react'
import { cn } from '#/lib/utils'
import { LOCALE_OPTIONS } from '#/lib/locale-pref-server'
import type { LocaleOption } from '#/lib/locale-pref-server'
import { useOnboardingForm } from '../form-state'

/**
 * LanguageStep: the onboarding screen that picks the recipe-content language
 * (#310). English is the default; Dutch shows the scraped originals. The picked
 * locale sets `draft.locale` ('en' | 'nl'); onboarding-mapping carries it to the
 * household's `preferredLocale` column.
 *
 * The list comes from the shared LOCALE_OPTIONS catalogue so onboarding and the
 * Profile Language sheet can't drift. App chrome stays English in v1; only recipe
 * CONTENT follows the locale.
 *
 * Mobile first at 390px: full-width tappable rows with the flag glyph, matching
 * the store step's row pattern.
 */
export function LanguageStep() {
  const { draft, patch } = useOnboardingForm()

  function pick(option: LocaleOption) {
    patch({ locale: option.slug })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="language-step">
      <div
        role="radiogroup"
        aria-label="Recipe language"
        className="flex flex-col gap-3"
      >
        {LOCALE_OPTIONS.map((option) => {
          const isSelected = draft.locale === option.slug
          return (
            <button
              key={option.slug}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => pick(option)}
              className={cn(
                'flex items-center gap-4 rounded-[var(--radius-ios)] border p-4 text-left transition active:scale-[0.98]',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <span aria-hidden className="text-3xl">
                {option.flag}
              </span>
              <span className="flex flex-1 flex-col">
                <span className="text-foreground font-semibold">
                  {option.name}
                </span>
              </span>
              {isSelected ? (
                <Check aria-hidden className="text-primary h-6 w-6 shrink-0" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
