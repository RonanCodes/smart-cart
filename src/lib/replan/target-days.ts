/**
 * Best-effort detection of which day(s) a free-text replan instruction names, so
 * the UI can pre-glow that DayCard WHILE Souso works (#replan-ux), before the
 * authoritative result lands. This is a presentation hint only: the actual
 * change is always decided server-side by the planner-grounded session, and the
 * post-change per-day glow (driven by the real diff) is what confirms it. If we
 * guess wrong or guess nothing, the chat card glows instead, so a miss is
 * harmless.
 *
 * Matches English (the canonical week labels) and the common Dutch day names
 * (Souso is Dutch-first), case-insensitively, on word boundaries. Returns the
 * canonical English labels that `WeekView.days[].day` uses, deduped, week order.
 */

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** Lowercased aliases → canonical English label. */
const ALIASES: Record<string, (typeof WEEK_DAYS)[number]> = {
  monday: 'Monday',
  maandag: 'Monday',
  tuesday: 'Tuesday',
  dinsdag: 'Tuesday',
  wednesday: 'Wednesday',
  woensdag: 'Wednesday',
  thursday: 'Thursday',
  donderdag: 'Thursday',
  friday: 'Friday',
  vrijdag: 'Friday',
  saturday: 'Saturday',
  zaterdag: 'Saturday',
  sunday: 'Sunday',
  zondag: 'Sunday',
}

/** Day labels named in the instruction, in week order, deduped. */
export function detectTargetDays(instruction: string): Array<string> {
  const found = new Set<string>()
  // \b word boundaries keep "sun" out of "sunshine" while still matching "sunday".
  const tokens = instruction.toLowerCase().match(/[a-z]+/g) ?? []
  for (const token of tokens) {
    const label = ALIASES[token]
    if (label) found.add(label)
  }
  return WEEK_DAYS.filter((d) => found.has(d))
}
