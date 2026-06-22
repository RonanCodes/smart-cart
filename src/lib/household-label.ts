/**
 * household-label — derives the human-readable "who this cooks for" label shown on
 * the week card (and anywhere a household's composition is surfaced).
 *
 * #373: the card hard-coded "🍽 2", which a 2-adult-plus-kids household read as
 * "this only feeds 2 people total". The fix is to DERIVE the label from the stored
 * household (adults + children) and spell out the composition, so "2" can never be
 * misread as the whole household size. A household with kids reads
 * "2 adults + 2 kids"; an adults-only one reads "2 adults".
 *
 * Pure + client-safe: no DB imports, so the week card can call it directly.
 */

export interface HouseholdComposition {
  adults: number
  children?: number
}

/** A household always has at least one cook; counts never go negative. */
function normalise(c: HouseholdComposition): {
  adults: number
  children: number
} {
  return {
    adults: Math.max(1, Math.floor(c.adults || 0)),
    children: Math.max(0, Math.floor(c.children ?? 0)),
  }
}

/**
 * "2 adults", "1 adult", "2 adults + 2 kids", "2 adults + 1 kid". Spelling out
 * adults vs kids is what stops the number being misread as a total head count.
 */
export function householdPortionsLabel(c: HouseholdComposition): string {
  const { adults, children } = normalise(c)
  const adultPart = `${adults} ${adults === 1 ? 'adult' : 'adults'}`
  if (children === 0) return adultPart
  const childPart = `${children} ${children === 1 ? 'kid' : 'kids'}`
  return `${adultPart} + ${childPart}`
}
