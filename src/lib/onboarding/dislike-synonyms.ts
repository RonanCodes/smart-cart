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

/**
 * Cross-language ingredient-exclusion groups (#452). The planner's dislike/allergy
 * hard filter matches an excluded term as a substring of a recipe's ingredient
 * names, but the catalogue is Dutch-first. So an English exclusion ("mushroom")
 * misses the Dutch ingredient ("champignon" / "paddenstoel") and the disliked
 * food leaks into the week. Each group below lists every spelling of one
 * ingredient across EN + NL, all lowercased; excluding ANY member of a group
 * excludes them ALL.
 *
 * Distinct from SYNONYM_GROUPS (the onboarding chip de-dup, US/UK display
 * variants): these are EN<->NL matching aliases used for the hard filter, kept
 * here so all ingredient-name knowledge lives in one module. Deliberately tight —
 * add a group only when the two terms are genuinely the SAME food in another
 * language, never "related" foods.
 */
const CROSSLANG_EXCLUSION_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['mushroom', 'champignon', 'paddenstoel', 'paddestoel'], // paddestoel = old spelling
  ['onion', 'ui'],
  ['garlic', 'knoflook'],
  ['coriander', 'cilantro', 'koriander'],
  ['aubergine', 'eggplant'], // 'aubergine' is the NL term too
  ['courgette', 'zucchini'],
  ['shrimp', 'prawn', 'prawns', 'garnaal', 'garnalen'],
  ['peanut', 'pinda', 'pindakaas'], // pindakaas = peanut butter
  ['walnut', 'walnoot'],
  ['hazelnut', 'hazelnoot'],
  ['celery', 'selderij', 'bleekselderij'],
  ['fennel', 'venkel'],
  ['anchovy', 'anchovies', 'ansjovis'],
  ['olive', 'olives', 'olijf', 'olijven'],
  ['cabbage', 'kool'],
  ['leek', 'prei'],
  ['spinach', 'spinazie'],
  ['cheese', 'kaas'],
  ['shellfish', 'schaaldieren'],
  ['salmon', 'zalm'],
  ['tuna', 'tonijn'],
  ['egg', 'ei', 'eieren'],
]

/**
 * Generic-fish exclusion (dietary-safety, #496). Distinct from the per-species
 * groups above: excluding the "Fish" avoid-chip ('fish') or its NL word ('vis')
 * must drop EVERY common finfish, because the catalogue is Dutch-first and names
 * fish as 'zalm' / 'tonijn' / 'kabeljauw' etc, none of which contains the substring
 * "fish". For a "no fish" household we take the SAFER (broader finfish)
 * interpretation and fan the exclusion out to the common species spellings below.
 *
 * Why a SEPARATE one-directional map instead of one more CROSSLANG group: the
 * crosslang map is symmetric (every member expands to the whole group), so folding
 * 'zalm' into a big fish group there would make excluding "salmon" alone ALSO drop
 * tuna/cod/etc. Keeping this generic fan-out one-way ('fish'/'vis' -> all finfish,
 * but 'zalm' -> just salmon via its own narrow group) preserves the precise
 * per-species groups while still making the "Fish" chip safe.
 *
 * FINFISH ONLY: shellfish stays its own group, so a "no fish" pick does NOT
 * silently also exclude prawns/shellfish (a separate allergy the user picks on its
 * own chip). NB: long-term this hand-maintained spelling list should be replaced by
 * embedding-based exclusion (ADR-0004) so we stop curating fish names by hand.
 */
const GENERIC_FISH_TERMS: ReadonlyArray<string> = [
  'fish',
  'vis',
  'zalm', // salmon
  'tonijn', // tuna
  'kabeljauw', // cod
  'haring', // herring
  'makreel', // mackerel
  'schol', // plaice
  'forel', // trout
  'zeebaars', // sea bass
  'pangasius',
  'tilapia',
]

/** The generic words that should fan out to every finfish spelling. */
const GENERIC_FISH_TRIGGERS: ReadonlySet<string> = new Set(['fish', 'vis'])

/** lowercased alias -> every term (incl. itself) in its cross-language group. */
const CROSSLANG_BY_ALIAS: ReadonlyMap<string, ReadonlyArray<string>> = (() => {
  const map = new Map<string, ReadonlyArray<string>>()
  for (const group of CROSSLANG_EXCLUSION_GROUPS) {
    const terms = group.map((t) => t.trim().toLowerCase())
    for (const alias of terms) {
      // Merge so an alias that appears in two groups (none today, but safe)
      // gets the union rather than the last group only.
      const existing = map.get(alias) ?? []
      map.set(alias, [...new Set([...existing, ...terms])])
    }
  }
  return map
})()

/**
 * Expand one excluded ingredient term to every cross-language spelling that means
 * the same food (#452), so a Dutch-first catalogue is filtered correctly however
 * the user phrased the exclusion. The term is lowercased; an unknown term expands
 * to just itself (lowercased), so a no-synonym exclusion behaves exactly as the
 * literal substring match did before. Returned terms are lowercased, deduped, and
 * always include the input.
 *
 * Generic "fish" / "vis" additionally fan out to every common finfish spelling
 * (dietary-safety, #496) so the Dutch-first catalogue ('zalm'/'tonijn'/...) is
 * caught; this is one-directional, so a per-species exclusion ('salmon') stays
 * narrow (see GENERIC_FISH_TERMS).
 */
export function expandExclusionSynonyms(term: string): Array<string> {
  const key = term.trim().toLowerCase()
  if (!key) return []
  if (GENERIC_FISH_TRIGGERS.has(key)) {
    return [...new Set([key, ...GENERIC_FISH_TERMS])]
  }
  const group = CROSSLANG_BY_ALIAS.get(key)
  if (!group) return [key]
  return [...new Set([key, ...group])]
}
