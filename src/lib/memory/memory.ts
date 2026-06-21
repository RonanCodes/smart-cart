/**
 * Pure shaping for per-household long-term memory (the shared agent memory).
 *
 * Memory is the durable taste/context the chat + voice agents recall before they
 * act and write to when they learn something. It persists across every surface
 * (chat, voice, plan generation, post-meal feedback) and is read ALONGSIDE
 * `household.profile`, never overwriting it, so nuance survives.
 *
 * The whole point is the nuance: a note like "not pizza every week" is a
 * VARIETY/frequency wish, not a dislike. The INTERPRETATION of free text is done
 * by an LLM, never by string matching — and almost always for free: the chat and
 * voice agents ARE the LLM, so when they call the `remember` tool they fill the
 * structured fields (`kind`, `cuisine`/`term`, `polarity`, `scope`) inline, with
 * no extra model call. The single exception is a post-meal feedback NOTE (no
 * agent in the loop), which is classified by one `generateObject` call (see
 * `classify.ts`).
 *
 * This module therefore stays PURELY deterministic: it normalises the explicit
 * fields, dedupes, formats the grounding block, and turns memory + history into
 * planner penalties. No natural-language guessing lives here. Pure (no DB, no
 * Worker deps) so it runs identically in the tests, the server fn, and the tools.
 */
import type { SoftPenalties } from '../planner/types'

/** What kind of memory this is (mirrors the `household_memory.kind` column). */
export type MemoryKind =
  | 'preference'
  | 'constraint'
  | 'variety'
  | 'context'
  | 'logistics'

/** Every memory kind, for tool/schema enums. */
export const MEMORY_KINDS: ReadonlyArray<MemoryKind> = [
  'preference',
  'constraint',
  'variety',
  'context',
  'logistics',
]

/** The direction of the signal, if any. */
export type MemoryPolarity = 'like' | 'dislike' | 'neutral'

/** Whether the memory always applies or only for the current week. */
export type MemoryScope = 'persistent' | 'week'

/** Where a memory came from. */
export type MemorySource = 'chat' | 'voice' | 'feedback' | 'system'

/** A stored memory row, as the server reads it back. */
export interface MemoryRecord {
  id: string
  householdId: string
  kind: MemoryKind
  content: string
  cuisine: string | null
  term: string | null
  polarity: MemoryPolarity
  scope: MemoryScope
  salience: number
  source: MemorySource
  expiresAt: Date | null
  active: boolean
  createdAt: Date
  updatedAt: Date
}

/** The signal-bearing fields of a memory (the LLM/agent fills these). */
export interface MemoryDraft {
  kind: MemoryKind
  cuisine: string | null
  term: string | null
  polarity: MemoryPolarity
  scope: MemoryScope
}

/**
 * What a writer hands `rememberFact`. `content` is the household's words; `kind`
 * is required (the caller — an agent or the note classifier — has already decided
 * it); the rest default deterministically. There is NO inference from `content`
 * here: interpretation is the LLM's job upstream, this module just normalises.
 */
export interface RememberInput {
  content: string
  source: MemorySource
  kind: MemoryKind
  cuisine?: string | null
  term?: string | null
  polarity?: MemoryPolarity
  scope?: MemoryScope
}

function normalise(s: string): string {
  return s.toLowerCase().trim()
}

/** Normalise a remember input into a draft. Deterministic: defaults only, no
 * guessing. Cuisine/term are lowercased; polarity/scope take neutral defaults. */
export function resolveDraft(input: RememberInput): MemoryDraft {
  return {
    kind: input.kind,
    cuisine: input.cuisine ? normalise(input.cuisine) : null,
    term: input.term ? normalise(input.term) : null,
    polarity: input.polarity ?? 'neutral',
    scope: input.scope ?? 'persistent',
  }
}

/**
 * Decide whether a new memory is a duplicate of an existing active one. Two
 * memories collide when they share the same `kind` + `polarity` AND target the
 * same thing (same cuisine, or same term, or — lacking both — identical
 * normalised content). A collision BUMPS the existing row (salience + refreshed
 * content/time) instead of stacking a near-identical second row, so re-stating a
 * preference makes it stronger rather than noisier. Pure set logic, not text
 * interpretation.
 */
export function findDuplicate(
  existing: Array<MemoryRecord>,
  draft: MemoryDraft,
  content: string,
): MemoryRecord | null {
  const normalisedContent = normalise(content)
  for (const m of existing) {
    if (!m.active) continue
    if (m.kind !== draft.kind || m.polarity !== draft.polarity) continue
    const sameCuisine =
      draft.cuisine != null && m.cuisine != null && m.cuisine === draft.cuisine
    const sameTerm =
      draft.term != null && m.term != null && m.term === draft.term
    const sameContent =
      draft.cuisine == null &&
      draft.term == null &&
      normalise(m.content) === normalisedContent
    if (sameCuisine || sameTerm || sameContent) return m
  }
  return null
}

/** What the server fn should do with a `rememberFact` call. */
export type MemoryWriteAction =
  | { kind: 'insert'; draft: MemoryDraft; content: string }
  | {
      kind: 'bump'
      id: string
      salience: number
      content: string
      draft: MemoryDraft
    }

/**
 * Plan the write for a remember call: bump an existing duplicate (salience + 1,
 * capped) or insert a fresh row. Pure, so the upsert branching is unit-testable
 * without the DB.
 */
export function planMemoryWrite(
  existing: Array<MemoryRecord>,
  input: RememberInput,
): MemoryWriteAction {
  const draft = resolveDraft(input)
  const content = input.content.trim()
  const dup = findDuplicate(existing, draft, content)
  if (dup) {
    return {
      kind: 'bump',
      id: dup.id,
      salience: Math.min(dup.salience + 1, 10),
      content,
      draft,
    }
  }
  return { kind: 'insert', draft, content }
}

/** One day of a week, summarised for the memory context block. */
export interface WeekDaySummary {
  day: string
  meal: string
  cuisine?: string | null
}

/** A week summarised for the memory context block. */
export interface WeekSummary {
  weekStart: string
  days: Array<WeekDaySummary>
}

/** One post-meal feedback, summarised for the memory context block. */
export interface FeedbackSummary {
  meal: string
  rating: 'up' | 'down' | null
  note: string | null
}

/** Everything the context builder folds into the agents' grounding block. */
export interface MemoryContextInput {
  memories: Array<MemoryRecord>
  currentWeek?: WeekSummary | null
  lastWeek?: WeekSummary | null
  feedback?: Array<FeedbackSummary>
}

function summariseWeek(
  label: string,
  week: WeekSummary | null | undefined,
): string {
  if (!week || week.days.length === 0) return `${label}: (none planned)`
  const lines = week.days
    .map((d) => {
      if (!d.meal) return `  - ${d.day}: (eating out / no dinner)`
      const cuisine = d.cuisine ? ` [${d.cuisine}]` : ''
      return `  - ${d.day}: ${d.meal}${cuisine}`
    })
    .join('\n')
  return `${label} (week of ${week.weekStart}):\n${lines}`
}

/**
 * Build the compact text block the agents read before acting. Deliberately
 * structured and short (the agents reason over it, they do not need prose):
 *   - durable memories, salience-first, so the strongest wishes lead,
 *   - last week's dinners + this week's dinners, so "not pizza every week" can be
 *     read against what was actually served (frequency, not a one-off),
 *   - recent post-meal feedback (thumbs + notes).
 *
 * Deterministic (sorted, trimmed). Empty sections are stated explicitly so the
 * model never guesses at missing data.
 */
export function formatMemoryContext(input: MemoryContextInput): string {
  const sections: Array<string> = []

  const active = input.memories
    .filter((m) => m.active)
    .slice()
    .sort((a, b) => {
      if (b.salience !== a.salience) return b.salience - a.salience
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

  if (active.length) {
    const lines = active
      .map((m) => {
        const tag = m.cuisine ?? m.term
        const focus = tag ? ` (${tag})` : ''
        return `  - [${m.kind}${focus}] ${m.content}`
      })
      .join('\n')
    sections.push(`What we remember about this household:\n${lines}`)
  } else {
    sections.push('What we remember about this household: (nothing yet)')
  }

  sections.push(summariseWeek("This week's dinners", input.currentWeek))
  sections.push(summariseWeek("Last week's dinners", input.lastWeek))

  const fb = input.feedback ?? []
  if (fb.length) {
    const lines = fb
      .map((f) => {
        const thumb =
          f.rating === 'up' ? '👍' : f.rating === 'down' ? '👎' : '·'
        const note = f.note ? ` — "${f.note}"` : ''
        return `  - ${thumb} ${f.meal}${note}`
      })
      .join('\n')
    sections.push(`Recent post-meal feedback:\n${lines}`)
  } else {
    sections.push('Recent post-meal feedback: (none yet)')
  }

  return sections.join('\n\n')
}

/** How recently-served history is summarised for the variety penalty. */
export interface RecentlyServed {
  /** Recipe id -> how many of the recent weeks it appeared in. */
  recipeCounts: Record<string, number>
  /** Cuisine (lowercased) -> how many recent dinners had that cuisine. */
  cuisineCounts: Record<string, number>
}

/** Tunable weights for turning memory + history into planner penalties. */
export interface PenaltyWeights {
  /** Per appearance in a recent week, penalty added for that exact recipe. */
  recencyPerWeek: number
  /** Penalty for a cuisine flagged 'variety', scaled by how often it recurred. */
  varietyPerRecentDinner: number
  /** Flat penalty for a disliked cuisine/term (soft, never a ban). */
  dislike: number
  /** Stronger penalty for a 'constraint' (allergy / strict avoid). */
  constraint: number
}

export const DEFAULT_PENALTY_WEIGHTS: PenaltyWeights = {
  recencyPerWeek: 0.5,
  varietyPerRecentDinner: 0.4,
  dislike: 0.6,
  constraint: 1.5,
}

/**
 * Turn memory + recent week history into the planner's `SoftPenalties`.
 *
 * The nuance lives here, as deterministic MATH over already-interpreted memory:
 *   - a 'variety' memory ("not pizza every week") only bites when that cuisine
 *     actually recurred recently — so it down-weights pizza in PROPORTION to how
 *     often it was just served, never bans it,
 *   - recently-served EXACT recipes get a recency penalty so the same dish does
 *     not reappear week after week,
 *   - dislikes/constraints add a flat soft penalty by cuisine/term.
 *
 * Likes add nothing (they already flow through swipes + the profile, so adding a
 * bonus here would double-count). Returns an empty `SoftPenalties` when there is
 * nothing to penalise, which leaves planner ranking unchanged.
 */
export function memoryToPenalties(
  memories: Array<MemoryRecord>,
  recent: RecentlyServed,
  weights: PenaltyWeights = DEFAULT_PENALTY_WEIGHTS,
): SoftPenalties {
  const cuisine: Record<string, number> = {}
  const term: Record<string, number> = {}
  const recipe: Record<string, number> = {}

  // Recency: each recent week a recipe appeared in adds a penalty, so a dish
  // served two weeks running is pushed down harder than a one-off.
  for (const [recipeId, count] of Object.entries(recent.recipeCounts)) {
    if (count > 0) recipe[recipeId] = count * weights.recencyPerWeek
  }

  const add = (
    map: Record<string, number>,
    key: string | null,
    amount: number,
  ) => {
    if (!key) return
    map[key] = (map[key] ?? 0) + amount
  }

  for (const m of memories) {
    if (!m.active) continue
    switch (m.kind) {
      case 'variety': {
        // Only penalise a cuisine the household is tired of IN PROPORTION to how
        // often it actually appeared recently. No recent appearances -> no bite.
        const c = m.cuisine
        if (c) {
          const recurrence = recent.cuisineCounts[c] ?? 0
          if (recurrence > 0) {
            add(cuisine, c, recurrence * weights.varietyPerRecentDinner)
          }
        }
        // A variety memory about a non-cuisine term ("not salmon every week")
        // leans on the term map at the same scale.
        if (m.term && m.term !== m.cuisine) {
          add(term, m.term, weights.varietyPerRecentDinner)
        }
        break
      }
      case 'constraint':
        if (m.polarity === 'dislike') {
          add(cuisine, m.cuisine, weights.constraint)
          add(term, m.term, weights.constraint)
        }
        break
      case 'preference':
        if (m.polarity === 'dislike') {
          add(cuisine, m.cuisine, weights.dislike)
          add(term, m.term, weights.dislike)
        }
        break
      // 'context' and 'logistics' carry no ranking penalty.
      default:
        break
    }
  }

  const out: SoftPenalties = {}
  if (Object.keys(cuisine).length) out.cuisine = cuisine
  if (Object.keys(term).length) out.term = term
  if (Object.keys(recipe).length) out.recipe = recipe
  return out
}
