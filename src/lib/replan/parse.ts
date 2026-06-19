import type { ReplanEdit } from './types'

/**
 * Deterministic intent parser.
 *
 * Tries a small ordered set of matchers against a plain-language instruction and
 * returns a structured `ReplanEdit`. No network, no LLM, fully unit tested. The
 * order matters: the more specific patterns (a named day, an explicit exclusion)
 * are checked before the looser ones so "no fish on Friday" is read as an
 * exclusion, not just a day swap.
 *
 * Returns `null` when nothing matched, which is the signal for the caller to fall
 * back to the AI SDK. The two cases that ARE matched but intentionally not acted
 * on (price intents) come back as a `needs-pricing` edit, not null, because we
 * recognised them and want to tell the user why we cannot do them yet.
 */

/** Monday-first week, the canonical day order (mirrors the planner). */
const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

/** Lowercase day -> canonical label, including common short forms. */
const DAY_ALIASES: Record<string, string> = {
  monday: 'Monday',
  mon: 'Monday',
  tuesday: 'Tuesday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  wednesday: 'Wednesday',
  wed: 'Wednesday',
  thursday: 'Thursday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  friday: 'Friday',
  fri: 'Friday',
  saturday: 'Saturday',
  sat: 'Saturday',
  sunday: 'Sunday',
  sun: 'Sunday',
}

/** A handful of cuisine words we treat as cuisines rather than ingredients. */
const CUISINE_WORDS = new Set([
  'italian',
  'mexican',
  'thai',
  'japanese',
  'chinese',
  'indian',
  'french',
  'spanish',
  'greek',
  'korean',
  'vietnamese',
  'american',
  'mediterranean',
  'pizza',
  'pasta',
  'curry',
  'sushi',
  'tapas',
])

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Find every day label named in the text, in canonical week order. */
function daysIn(text: string): Array<string> {
  const found = new Set<string>()
  // Word-boundary match each alias so "satay" never reads as "sat".
  for (const [alias, label] of Object.entries(DAY_ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, 'i')
    if (re.test(text)) found.add(label)
  }
  return WEEK_DAYS.filter((d) => found.has(d))
}

/** Classify a bare term as cuisine or ingredient. Pasta/pizza read as cuisine. */
function classifyTerm(term: string): 'cuisine' | 'ingredient' {
  return CUISINE_WORDS.has(term) ? 'cuisine' : 'ingredient'
}

/**
 * Try to read the instruction. Returns a `ReplanEdit` when matched, else null.
 * Order of checks (first win):
 *   1. price ("cheaper") -> needs-pricing (recognised, blocked on #14)
 *   2. exclude ("no fish", "no mexican this week")
 *   3. more-of ("more pasta")
 *   4. skip-day ("eating out wednesday", "skip friday")
 *   5. swap-day ("swap friday", "not this one", "don't like this")
 */
export function parseIntent(raw: string): ReplanEdit | null {
  const text = normalise(raw)
  if (!text) return null

  // 1. Price-dependent intents are recognised but blocked on the basket work.
  if (
    /\b(cheaper|cheapest|cheap|save money|lower the cost|reduce the cost|less expensive|budget)\b/.test(
      text,
    )
  ) {
    return {
      type: 'needs-pricing',
      days: [],
      term: null,
      termKind: null,
      reason: 'Making the week cheaper needs per-item prices (not built yet).',
    }
  }

  const days = daysIn(text)

  // 2. Exclude an ingredient or cuisine: "no fish", "no mexican this week",
  //    "without peanuts", "I don't want fish".
  const excludeMatch = text.match(
    /\b(?:no|not|without|avoid|skip the|don'?t want|hold the)\s+(?:the\s+)?([a-z][a-z\s]*?)(?:\s+(?:this week|please|tonight|again))?\.?$/,
  )
  if (excludeMatch) {
    const term = normalise(excludeMatch[1]!)
    // "not this one" / "not today" are swap/skip phrasings, not an exclusion of
    // a food term. Guard against the parser eating those.
    const swapWords = new Set([
      'this',
      'this one',
      'that',
      'that one',
      'it',
      'today',
    ])
    if (term && !swapWords.has(term)) {
      return {
        type: 'exclude',
        days,
        term,
        termKind: classifyTerm(term),
        reason: `Excluding ${term} from the week.`,
      }
    }
  }

  // 3. More of something: "more pasta", "more chicken please".
  const moreMatch = text.match(/\bmore\s+([a-z][a-z\s]*?)(?:\s+please)?\.?$/)
  if (moreMatch) {
    const term = normalise(moreMatch[1]!)
    if (term) {
      return {
        type: 'more-of',
        days,
        term,
        termKind: classifyTerm(term),
        reason: `Biasing the week toward ${term}.`,
      }
    }
  }

  // 4. Skip a day: "eating out wednesday", "skip friday", "out for dinner monday",
  //    "nothing on tuesday".
  if (
    days.length > 0 &&
    /\b(eating out|eat out|out for dinner|going out|skip|nothing on|no dinner|away)\b/.test(
      text,
    )
  ) {
    return {
      type: 'skip-day',
      days,
      term: null,
      termKind: null,
      reason: `Clearing ${days.join(', ')}.`,
    }
  }

  // 5. Swap a day: "swap friday", "change wednesday", "something else friday",
  //    "not this one", "don't like this", "give me another".
  if (/\b(swap|change|replace|something else|another|different)\b/.test(text)) {
    return {
      type: 'swap-day',
      days,
      term: null,
      termKind: null,
      reason: days.length
        ? `Swapping ${days.join(', ')} for the next-best pick.`
        : 'Swapping the current day for the next-best pick.',
    }
  }
  if (
    /\b(not this one|don'?t like (this|it)|dislike this|not that one)\b/.test(
      text,
    )
  ) {
    return {
      type: 'swap-day',
      days,
      term: null,
      termKind: null,
      reason: 'Swapping for the next-best pick.',
    }
  }

  return null
}
