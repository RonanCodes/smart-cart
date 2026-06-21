/**
 * Recipe locale picker. Recipes are scraped in Dutch (AH / Jumbo names,
 * ingredients, how-to steps). For the demo we bake an English translation
 * ALONGSIDE the Dutch (never overwriting it) into `titleEn` / `ingredientsEn` /
 * `instructionsEn`, and DEFAULT the display to English with a Dutch fallback.
 *
 * These helpers are the single seam every display surface goes through (week
 * cards, the recipe sheet, the shopping ingredient names) so the fallback rule
 * lives in one place and is unit-testable. A locale toggle is out of scope; the
 * intent here is just "English when we have it, Dutch otherwise".
 *
 * Pure, no I/O: callers select the *En columns off the recipe row and hand the
 * pair here. An empty / whitespace English value is treated as absent, so a
 * partially-translated row never shows a blank string.
 *
 * Locale toggle (#310): each picker takes an optional `locale`. 'en' (the
 * default, matching the household column default) keeps the original behaviour:
 * English when present, Dutch fallback. 'nl' forces the Dutch source so a user
 * who picks Dutch always sees the scraped original, even on rows that DO carry a
 * translation. Defaulting the param to 'en' keeps every pre-#310 caller correct.
 */

/** The recipe-content display locale. English is the demo default; Dutch shows
 * the scraped source verbatim. App chrome stays English in v1. */
export type Locale = 'en' | 'nl'

/** An ingredient line as stored on a recipe row (qty + unit are optional). */
export interface RecipeIngredientLine {
  name: string
  qty?: string
  unit?: string
  productId?: string
}

const hasText = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== ''

/**
 * Pick the title to display. With locale 'en' (default): the English
 * translation when present, else the Dutch source (a blank / whitespace English
 * title also falls back to Dutch). With locale 'nl': always the Dutch source.
 */
export function pickTitle(
  title: string,
  titleEn?: string | null,
  locale: Locale = 'en',
): string {
  if (locale === 'nl') return title
  return hasText(titleEn) ? titleEn : title
}

/**
 * Pick the instruction steps to display. With locale 'en' (default): the
 * English steps when the array is present and non-empty, else the Dutch steps
 * (an empty English array is treated as "not translated"). With locale 'nl':
 * always the Dutch steps.
 */
export function pickInstructions(
  instructions: Array<string> | null | undefined,
  instructionsEn?: Array<string> | null,
  locale: Locale = 'en',
): Array<string> {
  if (
    locale === 'en' &&
    Array.isArray(instructionsEn) &&
    instructionsEn.length > 0
  ) {
    return instructionsEn
  }
  return instructions ?? []
}

/**
 * Pick the ingredient lines to display. With locale 'en' (default): the English
 * lines when present and non-empty, else the Dutch lines. With locale 'nl':
 * always the Dutch lines. The English lines carry the same qty / unit
 * (quantities are language-agnostic), so only the `name` actually differs; the
 * caller's downstream parsing (qty/unit split, consolidation) is unaffected.
 */
export function pickIngredients(
  ingredients: Array<RecipeIngredientLine> | null | undefined,
  ingredientsEn?: Array<RecipeIngredientLine> | null,
  locale: Locale = 'en',
): Array<RecipeIngredientLine> {
  if (
    locale === 'en' &&
    Array.isArray(ingredientsEn) &&
    ingredientsEn.length > 0
  ) {
    return ingredientsEn
  }
  return ingredients ?? []
}
