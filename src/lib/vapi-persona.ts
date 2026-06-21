/**
 * Souso's voice persona, as VAPI assistant overrides.
 *
 * The base assistant (its name, its VOICE, and its LLM provider) lives in the
 * VAPI dashboard — we cannot pick a voice from here, only nudge text fields. What
 * we CAN do from the app, per-call, is override the system prompt, the opening
 * line, and the template variables. So this module builds:
 *
 *  - a system prompt that gives Souso a warm, concise sous-chef personality AND
 *    grounds the call in THIS week's dinners (so "make Tuesday veggie" works
 *    without the user naming the week),
 *  - a first message that greets by week + opens the floor,
 *  - `variableValues` so any `{{ ... }}` templating in the dashboard assistant
 *    still resolves (week label + the dinner list).
 *
 * Pure + dependency-free so it can be unit-tested without a request context. The
 * token route assembles the inputs (week label + dinners) server-side and hands
 * the result to the browser, which passes it to `vapi.start(id, overrides)`.
 */

/** One planned dinner, reduced to what the persona needs to speak about it. */
export interface PersonaDay {
  /** Day label, Monday first, e.g. "Tuesday". */
  day: string
  /** The dish title, or '' when the household is eating out / hasn't planned it. */
  meal: string
}

export interface PersonaInput {
  /** Human week label for the open week, e.g. "This week" or "Next week". */
  weekLabel: string
  /** The seven days in calendar order (Monday first). */
  days: Array<PersonaDay>
}

/** The subset of VAPI `AssistantOverrides` we set per call.
 *
 * IMPORTANT: we deliberately do NOT override `model` here. VAPI rejects/hangs on
 * a PARTIAL model override (`{ messages }` with no provider+model), which left
 * the call stuck "connecting". We only send the safe, mergeable fields
 * (firstMessage + variableValues). The persona SYSTEM PROMPT (buildPersonaSystemPrompt)
 * belongs in the dashboard assistant; `variableValues` expose the week so a
 * dashboard `{{ weekPlan }}` / `{{ weekLabel }}` template grounds it per call. */
export interface PersonaOverrides {
  firstMessage: string
  variableValues: {
    weekLabel: string
    weekPlan: string
  }
}

/** Render the week as a compact, speakable list ("Monday: …\nTuesday: (eating out)"). */
export function describeWeekForVoice(days: Array<PersonaDay>): string {
  if (days.length === 0) return '(no week planned yet)'
  return days
    .map((d) => `${d.day}: ${d.meal.trim() || '(eating out)'}`)
    .join('\n')
}

/**
 * Build Souso's per-call system prompt. The persona rules come first (who Souso
 * is + how Souso talks), then the grounded week so the model defaults to editing
 * the open week unless the user names another.
 */
export function buildPersonaSystemPrompt(input: PersonaInput): string {
  const weekPlan = describeWeekForVoice(input.days)
  return [
    "You are Souso, a warm, upbeat sous-chef who helps plan the week's dinners by voice.",
    'Personality: friendly, encouraging, never fussy. You sound like a calm friend who happens to be great in the kitchen.',
    '',
    'How you talk:',
    '- Keep every spoken reply SHORT — one or two sentences. No lists read aloud, no preamble.',
    '- Act first, talk second: when the user asks for a change, make it, then confirm in a few words.',
    '- Confirm what changed, not how you did it ("Done — Tuesday is now a veggie curry.").',
    '- Ask a clarifying question ONLY when you genuinely cannot act; otherwise pick a sensible default and go.',
    '- Never invent a dish. The tools always pick a real recipe; you only name the constraint.',
    '',
    'Default subject: the conversation is about the week below unless the user clearly names another week.',
    'So "make Tuesday veggie" or "something quicker on Friday" means THIS week, no need to ask which week.',
    '',
    `Open week: ${input.weekLabel}`,
    "This week's dinners:",
    weekPlan,
    '',
    'When the user asks to change the plan, call the replan tool with their instruction verbatim, then read back only what moved.',
  ].join('\n')
}

/** Build Souso's opening line for the call. */
export function buildPersonaFirstMessage(input: PersonaInput): string {
  const planned = input.days.filter((d) => d.meal.trim()).length
  if (planned === 0) {
    return "Hi, I'm Souso. You don't have dinners planned yet — want me to set up the week?"
  }
  return `Hi, I'm Souso. I've got ${input.weekLabel.toLowerCase()} in front of me — what would you like to change?`
}

/**
 * Assemble the full per-call override object handed to `vapi.start`. The base
 * assistant's voice + model PROVIDER stay as configured in the dashboard; we only
 * override the prompt text, the opening line, and the template variables.
 */
export function buildPersonaOverrides(input: PersonaInput): PersonaOverrides {
  return {
    firstMessage: buildPersonaFirstMessage(input),
    variableValues: {
      weekLabel: input.weekLabel,
      weekPlan: describeWeekForVoice(input.days),
    },
  }
}
