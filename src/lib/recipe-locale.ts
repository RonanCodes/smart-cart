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
 */

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
 * Pick the title to display: the English translation when present, else the
 * Dutch source. A blank / whitespace English title falls back to Dutch.
 */
export function pickTitle(title: string, titleEn?: string | null): string {
  return hasText(titleEn) ? titleEn : title
}

/**
 * Pick the instruction steps to display: the English steps when the array is
 * present and non-empty, else the Dutch steps. We treat an empty English array
 * as "not translated" so a row with `instructionsEn: []` still shows Dutch.
 */
export function pickInstructions(
  instructions: Array<string> | null | undefined,
  instructionsEn?: Array<string> | null,
): Array<string> {
  if (Array.isArray(instructionsEn) && instructionsEn.length > 0) {
    return instructionsEn
  }
  return instructions ?? []
}

/**
 * Pick the ingredient lines to display: the English lines when present and
 * non-empty, else the Dutch lines. The English lines carry the same qty / unit
 * (quantities are language-agnostic), so only the `name` actually differs; the
 * caller's downstream parsing (qty/unit split, consolidation) is unaffected.
 */
export function pickIngredients(
  ingredients: Array<RecipeIngredientLine> | null | undefined,
  ingredientsEn?: Array<RecipeIngredientLine> | null,
): Array<RecipeIngredientLine> {
  if (Array.isArray(ingredientsEn) && ingredientsEn.length > 0) {
    return ingredientsEn
  }
  return ingredients ?? []
}
