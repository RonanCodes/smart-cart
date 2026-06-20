/**
 * Food-term synonym expansion for replan "more-of" / "exclude" biases.
 *
 * The catalogue (AH / Jumbo) is Dutch: titles and ingredients read "rijst", not
 * "rice"; "kip", not "chicken". A user types in English ("more rice"), so a bare
 * substring match against the Dutch text never bites, and the lean silently does
 * nothing. This map bridges the two: a typed term expands to every variant we
 * should match in the catalogue text (the term itself plus its NL/EN cousins and
 * common dish words), so "rice" matches "rijst", "risotto", and "rice".
 *
 * Pure data + a tiny lookup so it is unit-testable and shared by the matcher in
 * `apply.ts`. Keys and values are lowercase. The term itself is always included in
 * its own expansion, so an unmapped term still matches its literal text.
 */

/**
 * term -> the set of substrings that count as a match for that term. English on
 * the left (what the user types), Dutch + dish-word variants on the right (what
 * the catalogue actually says). Kept narrow on purpose: each variant is a
 * substring we are happy to see anywhere in title + ingredients + cuisine.
 */
const SYNONYMS: Record<string, Array<string>> = {
  rice: ['rice', 'rijst', 'risotto', 'nasi', 'paella'],
  pasta: [
    'pasta',
    'spaghetti',
    'penne',
    'lasagne',
    'lasagna',
    'tagliatelle',
    'macaroni',
    'noodle',
    'noedel',
    'farfalle',
    'fusilli',
    'rigatoni',
    'gnocchi',
    'ravioli',
    'orzo',
  ],
  noodle: ['noodle', 'noedel', 'mie', 'ramen', 'udon'],
  noodles: ['noodle', 'noedel', 'mie', 'ramen', 'udon'],
  chicken: ['chicken', 'kip', 'ajam'],
  beef: ['beef', 'rund', 'biefstuk', 'rundvlees'],
  pork: ['pork', 'varken', 'varkens', 'spek'],
  fish: ['fish', 'vis', 'zalm', 'salmon', 'kabeljauw', 'tonijn', 'tuna'],
  salmon: ['salmon', 'zalm'],
  shrimp: ['shrimp', 'garnaal', 'garnalen', 'prawn'],
  potato: ['potato', 'aardappel', 'aardappels', 'krieltjes'],
  potatoes: ['potato', 'aardappel', 'aardappels', 'krieltjes'],
  cheese: ['cheese', 'kaas'],
  egg: ['egg', 'ei', 'eieren'],
  eggs: ['egg', 'ei', 'eieren'],
  bean: ['bean', 'boon', 'bonen'],
  beans: ['bean', 'boon', 'bonen'],
  tofu: ['tofu'],
  mushroom: ['mushroom', 'paddenstoel', 'champignon'],
  mushrooms: ['mushroom', 'paddenstoel', 'champignon'],
  vegetable: ['vegetable', 'groente', 'groenten', 'veggie'],
  vegetables: ['vegetable', 'groente', 'groenten', 'veggie'],
  veggie: ['vegetable', 'groente', 'groenten', 'veggie'],
  curry: ['curry', 'kerrie'],
  soup: ['soup', 'soep'],
  salad: ['salad', 'salade', 'sla'],
  bread: ['bread', 'brood'],
  spicy: ['spicy', 'pittig', 'pikant', 'chili', 'sambal'],
}

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/**
 * Expand a typed term into every substring that should count as a match. Always
 * includes the term itself (so an unmapped term still matches its literal text)
 * and de-duplicates. The result is lowercase, ready for substring matching.
 */
export function expandTerm(term: string): Array<string> {
  const t = normalise(term)
  if (!t) return []
  const mapped = SYNONYMS[t] ?? []
  return [...new Set([t, ...mapped])]
}
