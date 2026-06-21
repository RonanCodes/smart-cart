/**
 * Synonym de-duplication for the onboarding "ingredients to avoid" list (#370).
 *
 * Some avoid-ingredients are the SAME thing under two names — most obviously
 * cilantro and coriander (US vs UK/EU for Coriandrum sativum). Showing a user
 * both as separate chips, or asking them about both, is confusing and lets the
 * same dislike be selected twice. This module canonicalises each label to a
 * single representative so the chip list, the autocomplete suggestions, and the
 * stored selection never carry two names for one ingredient.
 *
 * Pure + side-effect free so it is trivial to unit-test and call on render.
 */

/**
 * Groups of labels that mean the same ingredient. The FIRST entry of each group
 * is the canonical display label we keep; the rest collapse onto it. Matching is
 * case-insensitive on the trimmed label.
 *
 * Kept deliberately small and obvious — widen only with real synonym pairs, not
 * "related" ingredients (eggplant/aubergine are the same; onion/shallot are not).
 */
export const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['Coriander', 'Cilantro'],
  ['Aubergine', 'Eggplant'],
  ['Courgette', 'Zucchini'],
  ['Prawns', 'Shrimp'],
  ['Chilli', 'Chili', 'Chile'],
]

/** label (lowercased) -> canonical label (lowercased) for every non-canonical. */
const CANONICAL_BY_ALIAS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const group of SYNONYM_GROUPS) {
    const canonical = group[0]!.trim().toLowerCase()
    for (const alias of group) {
      map.set(alias.trim().toLowerCase(), canonical)
    }
  }
  return map
})()

/**
 * Canonicalise one label to a single stable key for its synonym group, so two
 * names for the same ingredient compare equal. A label with no known synonym
 * canonicalises to its own lowercased form. The returned value is a comparison
 * KEY (lowercased), not a display label.
 */
export function canonicalDislikeKey(label: string): string {
  const key = label.trim().toLowerCase()
  return CANONICAL_BY_ALIAS.get(key) ?? key
}

/**
 * Collapse a list of avoid-labels so each synonym group (and each plain
 * case-duplicate) appears at most once. The FIRST occurrence wins and is kept
 * verbatim with its display casing; later names for the same ingredient are
 * dropped. So a preset list carrying both 'Cilantro' and 'Coriander' keeps only
 * the first, and 'Egg' + 'egg' collapse to one.
 *
 * Used to build the preset chip set and to filter autocomplete suggestions, so a
 * user is never shown — or asked about — two names for one ingredient.
 */
export function dedupeSynonyms(labels: ReadonlyArray<string>): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const label of labels) {
    const canonKey = canonicalDislikeKey(label)
    if (seen.has(canonKey)) continue
    seen.add(canonKey)
    out.push(label)
  }
  return out
}
