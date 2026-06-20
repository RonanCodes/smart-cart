import { applyReplan } from './apply'
import { runAiFallback } from './fallback'
import { parseIntent } from './parse'
import { buildTermMatcherLive } from './term-match'
import type { AiFallbackDeps } from './fallback'
import type { EmbedTermFn } from './term-match'
import type { ReplanContext, ReplanEdit, ReplanResult } from './types'

/**
 * Deps for the embedding term-matcher (exclude / more-of). When both are present,
 * the engine embeds the edit's term once and builds a cosine matcher against the
 * recipe vectors (ADR-0004). Absent (no key / no vectors) => the term intents
 * decline cleanly; there is no substring fallback.
 */
export interface TermMatchDeps {
  /** Embed one term to a vector (the embeddings module's `embedQuery`). */
  embedTerm?: EmbedTermFn
  /** Recipe id -> precomputed vector, loaded from D1 upstream. */
  recipeVectors?: Map<string, ReadonlyArray<number>>
}

/**
 * The replan engine entry point.
 *
 * One call: instruction in, new week out. Deterministic-first.
 *  1. `parseIntent` reads the common cases with no network. If it matches, the
 *     edit is applied immediately (source: 'deterministic').
 *  2. If it returns null, the AI SDK fallback runs (`runAiFallback`) and produces
 *     the same structured edit, which is then applied (source: 'ai-fallback').
 *     With no model wired (no API key / binding) the fallback declines cleanly and
 *     the result is a clear "can't do that yet" rather than a thrown error or a
 *     mangled week.
 *
 * For exclude / more-of, the term is matched semantically: when `termMatch` carries
 * an embed fn + the recipe vectors, the term is embedded once and a cosine matcher
 * is attached to the context before applying. With no embed capability the term
 * intents decline cleanly (no substring fallback).
 *
 * Either way the actual recipe re-pick goes through the planner core (`applyReplan`
 * -> `generateWeek`); we never reimplement ranking here.
 */
export async function replan(
  instruction: string,
  ctx: ReplanContext,
  aiDeps: AiFallbackDeps = {},
  termMatch: TermMatchDeps = {},
): Promise<ReplanResult> {
  const deterministic = parseIntent(instruction)
  if (deterministic) {
    const c = await withTermMatcher(ctx, deterministic, termMatch)
    return applyReplan(deterministic, c, 'deterministic')
  }

  // Ground the model in the household's hard filters + the real catalogue unless
  // the caller already passed its own context. The planner still enforces every
  // filter downstream; this only stops the model emitting an impossible bias.
  const deps: AiFallbackDeps = aiDeps.promptContext
    ? aiDeps
    : {
        ...aiDeps,
        promptContext: { profile: ctx.profile, recipes: ctx.recipes },
      }

  const edit = await runAiFallback(instruction, deps)
  const c = await withTermMatcher(ctx, edit, termMatch)
  return applyReplan(edit, c, 'ai-fallback')
}

/**
 * Attach a semantic term matcher to the context for a term-driven edit. For an
 * exclude / more-of with a real term and the embed capability wired, embed the term
 * once and build the cosine matcher; otherwise return the context unchanged (the
 * apply step then declines the term intent cleanly). Day-only intents never need a
 * matcher, so we skip the embed call for them.
 */
async function withTermMatcher(
  ctx: ReplanContext,
  edit: ReplanEdit,
  termMatch: TermMatchDeps,
): Promise<ReplanContext> {
  const needsTerm = edit.type === 'exclude' || edit.type === 'more-of'
  if (!needsTerm || !edit.term) return ctx
  if (ctx.matchTerm) return ctx // caller pre-built one (tests)
  const { embedTerm, recipeVectors } = termMatch
  if (!embedTerm || !recipeVectors) return ctx
  const matcher = await buildTermMatcherLive(
    edit.term,
    recipeVectors,
    embedTerm,
  )
  return matcher ? { ...ctx, matchTerm: matcher } : ctx
}
