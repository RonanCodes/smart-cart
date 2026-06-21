/**
 * Server-side reads/writes for per-household memory (the shared agent memory).
 *
 * Server-only and deliberately NOT a `createServerFn`: these are called from
 * other server-only contexts — the agent tool handlers, the VAPI dispatch, the
 * planner data layer, and the feedback bridge — never directly from the client.
 * Every collaborator is dynamically imported inside the function so none of it
 * (nor the D1 binding) leaks into the client bundle (the planner-core pattern).
 *
 * The household id is always passed in by a caller that has already verified the
 * signed-in user (or the signed VAPI call token), never read from a tool arg.
 */
import {
  formatMemoryContext,
  memoryToPenalties,
  planMemoryWrite,
} from './memory'
import type {
  FeedbackSummary,
  MemoryContextInput,
  MemoryRecord,
  MemorySource,
  RecentlyServed,
  RememberInput,
  WeekSummary,
} from './memory'
import type { SoftPenalties } from '../planner/types'

/** How many recent distinct weeks the variety/recency penalty looks back over. */
const RECENT_WEEKS_LOOKBACK = 3
/** How many recent feedback rows to fold into the agents' context block. */
const RECENT_FEEDBACK_LIMIT = 12

/** Map a raw `household_memory` row to the pure `MemoryRecord` shape. */
function toRecord(row: {
  id: string
  householdId: string
  kind: string
  content: string
  cuisine: string | null
  term: string | null
  polarity: string
  scope: string
  salience: number
  source: string
  expiresAt: Date | null
  active: boolean
  createdAt: Date
  updatedAt: Date
}): MemoryRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    kind: row.kind as MemoryRecord['kind'],
    content: row.content,
    cuisine: row.cuisine,
    term: row.term,
    polarity: row.polarity as MemoryRecord['polarity'],
    scope: row.scope as MemoryRecord['scope'],
    salience: row.salience,
    source: row.source as MemoryRecord['source'],
    expiresAt: row.expiresAt,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * All currently-applicable memories for a household: active, and not past their
 * expiry (week-scoped memories drop out once their week has passed). Strongest
 * (highest salience) first so callers that truncate keep the most important.
 */
export async function recallMemory(
  householdId: string,
): Promise<Array<MemoryRecord>> {
  const { getDb } = await import('../../db/client')
  const { householdMemory } = await import('../../db/schema')
  const { eq, and, desc } = await import('drizzle-orm')
  const db = await getDb()

  const rows = await db
    .select()
    .from(householdMemory)
    .where(
      and(
        eq(householdMemory.householdId, householdId),
        eq(householdMemory.active, true),
      ),
    )
    .orderBy(desc(householdMemory.salience), desc(householdMemory.createdAt))

  const now = Date.now()
  return rows
    .map(toRecord)
    .filter((m) => !m.expiresAt || m.expiresAt.getTime() > now)
}

/**
 * Write a memory for a household, idempotently. Re-stating an existing fact
 * (same kind + polarity + cuisine/term, see `planMemoryWrite`) BUMPS the existing
 * row's salience instead of stacking a near-duplicate, so the strongest wishes
 * surface first and the store stays clean. Returns the resulting record.
 */
export async function rememberFact(
  householdId: string,
  input: RememberInput,
): Promise<MemoryRecord> {
  const content = input.content.trim()
  if (!content) throw new Error('memory content required')

  const { getDb } = await import('../../db/client')
  const { householdMemory } = await import('../../db/schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  const existing = await recallMemory(householdId)
  const action = planMemoryWrite(existing, input)
  const now = new Date()

  if (action.kind === 'bump') {
    await db
      .update(householdMemory)
      .set({
        salience: action.salience,
        content: action.content,
        cuisine: action.draft.cuisine,
        term: action.draft.term,
        kind: action.draft.kind,
        polarity: action.draft.polarity,
        scope: action.draft.scope,
        updatedAt: now,
      })
      .where(eq(householdMemory.id, action.id))
    const refreshed = existing.find((m) => m.id === action.id)!
    return {
      ...refreshed,
      salience: action.salience,
      content: action.content,
      cuisine: action.draft.cuisine,
      term: action.draft.term,
      kind: action.draft.kind,
      polarity: action.draft.polarity,
      scope: action.draft.scope,
      updatedAt: now,
    }
  }

  const id = crypto.randomUUID()
  const expiresAt =
    action.draft.scope === 'week'
      ? new Date(now.getTime() + 1000 * 60 * 60 * 24 * 8)
      : null
  await db.insert(householdMemory).values({
    id,
    householdId,
    kind: action.draft.kind,
    content: action.content,
    cuisine: action.draft.cuisine,
    term: action.draft.term,
    polarity: action.draft.polarity,
    scope: action.draft.scope,
    salience: 1,
    source: input.source,
    expiresAt,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id,
    householdId,
    kind: action.draft.kind,
    content: action.content,
    cuisine: action.draft.cuisine,
    term: action.draft.term,
    polarity: action.draft.polarity,
    scope: action.draft.scope,
    salience: 1,
    source: input.source,
    expiresAt,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Remember a free-text NOTE from a household (the one writer with no agent in the
 * loop, e.g. a post-meal feedback note). Exactly one LLM call: `classifyNote`
 * turns the words into a structured draft so "not pizza every week" lands as a
 * variety memory, not a dislike. With no model wired (no key) it degrades to a
 * neutral 'context' memory rather than guessing — never a wrong penalty.
 */
export async function rememberNote(
  householdId: string,
  note: string,
  source: MemorySource,
): Promise<MemoryRecord | null> {
  const content = note.trim()
  if (!content) return null

  const { classifyNote } = await import('./classify')
  const model = await loadClassifierModel()
  const draft = await classifyNote(content, { model })

  if (draft) {
    return rememberFact(householdId, {
      content,
      source,
      kind: draft.kind,
      cuisine: draft.cuisine,
      term: draft.term,
      polarity: draft.polarity,
      scope: draft.scope,
    })
  }

  // No model (or it declined): store the note verbatim as neutral context so it
  // is still remembered and surfaced to the agents, but never mis-penalises.
  return rememberFact(householdId, {
    content,
    source,
    kind: 'context',
    polarity: 'neutral',
  })
}

/** The classifier model, gated on OPENAI_API_KEY. Null degrades to context. */
async function loadClassifierModel() {
  const { readEnv } = await import('../env')
  const key = await readEnv('OPENAI_API_KEY')
  if (!key) return null
  try {
    const { models } = await import('../models')
    return models.fast
  } catch {
    return null
  }
}

/** A recent week's plan, denormalised with each dinner's cuisine. */
interface RecentWeek {
  weekStart: string
  days: Array<{
    day: string
    meal: string
    recipeRef: string
    cuisine: string | null
  }>
}

/**
 * Load the most recent distinct weeks for a household (one row per weekStart, the
 * latest revision of each), newest first, enriched with each dinner's cuisine.
 * Shared by the context builder (needs the latest two weeks) and the penalty
 * builder (looks back `RECENT_WEEKS_LOOKBACK` weeks).
 */
async function loadRecentWeeks(
  householdId: string,
  limitWeeks: number,
): Promise<Array<RecentWeek>> {
  const { getDb } = await import('../../db/client')
  const { mealPlan, recipe } = await import('../../db/schema')
  const { eq, desc, inArray } = await import('drizzle-orm')
  const db = await getDb()

  const rows = await db
    .select({
      weekStart: mealPlan.weekStart,
      plan: mealPlan.plan,
      createdAt: mealPlan.createdAt,
    })
    .from(mealPlan)
    .where(eq(mealPlan.householdId, householdId))
    .orderBy(desc(mealPlan.createdAt))
    .limit(50)

  // Dedupe to the latest revision per weekStart, newest week first.
  const byWeek = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (!byWeek.has(r.weekStart)) byWeek.set(r.weekStart, r)
  }
  const weeks = [...byWeek.values()].slice(0, limitWeeks)

  const refs = new Set<string>()
  for (const w of weeks) {
    for (const d of w.plan.days) if (d.recipeRef) refs.add(d.recipeRef)
  }
  const cuisineById = new Map<string, string | null>()
  if (refs.size) {
    const recipeRows = await db
      .select({ id: recipe.id, cuisine: recipe.cuisine })
      .from(recipe)
      .where(inArray(recipe.id, [...refs]))
    for (const r of recipeRows) cuisineById.set(r.id, r.cuisine)
  }

  return weeks.map((w) => ({
    weekStart: w.weekStart,
    days: w.plan.days.map((d) => ({
      day: d.day,
      meal: d.meal,
      recipeRef: d.recipeRef ?? '',
      cuisine: d.recipeRef ? (cuisineById.get(d.recipeRef) ?? null) : null,
    })),
  }))
}

function toWeekSummary(week: RecentWeek | undefined): WeekSummary | null {
  if (!week) return null
  return {
    weekStart: week.weekStart,
    days: week.days.map((d) => ({
      day: d.day,
      meal: d.meal,
      cuisine: d.cuisine,
    })),
  }
}

/** Recent post-meal feedback (thumbs + notes), newest first, with the meal title. */
async function loadRecentFeedback(
  householdId: string,
): Promise<Array<FeedbackSummary>> {
  const { getDb } = await import('../../db/client')
  const { mealFeedback, recipe } = await import('../../db/schema')
  const { eq, desc } = await import('drizzle-orm')
  const db = await getDb()

  const rows = await db
    .select({
      recipeId: mealFeedback.recipeId,
      rating: mealFeedback.rating,
      note: mealFeedback.note,
      title: recipe.title,
    })
    .from(mealFeedback)
    .leftJoin(recipe, eq(recipe.id, mealFeedback.recipeId))
    .where(eq(mealFeedback.householdId, householdId))
    .orderBy(desc(mealFeedback.createdAt))
    .limit(RECENT_FEEDBACK_LIMIT)

  return rows.map((r) => ({
    meal: r.title ?? 'a dinner',
    rating: r.rating === 'up' || r.rating === 'down' ? r.rating : null,
    note: r.note,
  }))
}

/**
 * Assemble the grounding block the chat + voice agents read before acting:
 * durable memories + this week's dinners + last week's dinners + recent
 * post-meal feedback. Returns the formatted text AND the raw memories (so a
 * caller can both show the block and reason over the structured rows).
 */
export async function buildMemoryContext(
  householdId: string,
): Promise<{ text: string; memories: Array<MemoryRecord> }> {
  const [memories, weeks, feedback] = await Promise.all([
    recallMemory(householdId),
    loadRecentWeeks(householdId, 2),
    loadRecentFeedback(householdId),
  ])

  const input: MemoryContextInput = {
    memories,
    currentWeek: toWeekSummary(weeks[0]),
    lastWeek: toWeekSummary(weeks[1]),
    feedback,
  }
  return { text: formatMemoryContext(input), memories }
}

/**
 * A plain-text summary of the household's current week, for the agents' `get_week`
 * tool. Returns a clear "nothing planned" line when there is no week yet.
 */
export async function getWeekText(householdId: string): Promise<string> {
  const weeks = await loadRecentWeeks(householdId, 1)
  const w = weeks[0]
  if (!w) return 'There is no week planned yet.'
  const lines = w.days
    .map((d) =>
      d.meal
        ? `  - ${d.day}: ${d.meal}${d.cuisine ? ` (${d.cuisine})` : ''}`
        : `  - ${d.day}: eating out / no dinner`,
    )
    .join('\n')
  return `This week's dinners (week of ${w.weekStart}):\n${lines}`
}

/**
 * Build the planner's soft penalties from memory + recent week history: variety
 * wishes scaled by how often a cuisine actually recurred, recently-served exact
 * recipes, and soft dislike/constraint penalties. Returns an empty object when
 * there is nothing to penalise (so the planner path is unchanged).
 */
export async function loadPlannerPenalties(
  householdId: string,
): Promise<SoftPenalties> {
  const [memories, weeks] = await Promise.all([
    recallMemory(householdId),
    loadRecentWeeks(householdId, RECENT_WEEKS_LOOKBACK),
  ])

  const recipeCounts: Record<string, number> = {}
  const cuisineCounts: Record<string, number> = {}
  for (const w of weeks) {
    const seenRecipeThisWeek = new Set<string>()
    for (const d of w.days) {
      if (d.recipeRef && !seenRecipeThisWeek.has(d.recipeRef)) {
        seenRecipeThisWeek.add(d.recipeRef)
        recipeCounts[d.recipeRef] = (recipeCounts[d.recipeRef] ?? 0) + 1
      }
      if (d.cuisine) {
        const c = d.cuisine.toLowerCase().trim()
        cuisineCounts[c] = (cuisineCounts[c] ?? 0) + 1
      }
    }
  }

  const recent: RecentlyServed = { recipeCounts, cuisineCounts }
  return memoryToPenalties(memories, recent)
}
