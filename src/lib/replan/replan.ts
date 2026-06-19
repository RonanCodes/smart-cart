import { applyReplan } from './apply'
import { runAiFallback } from './fallback'
import { parseIntent } from './parse'
import type { AiFallbackDeps } from './fallback'
import type { ReplanContext, ReplanResult } from './types'

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
 * Either way the actual recipe re-pick goes through the planner core (`applyReplan`
 * -> `generateWeek`); we never reimplement ranking here.
 */
export async function replan(
  instruction: string,
  ctx: ReplanContext,
  aiDeps: AiFallbackDeps = {},
): Promise<ReplanResult> {
  const deterministic = parseIntent(instruction)
  if (deterministic) {
    return applyReplan(deterministic, ctx, 'deterministic')
  }

  const edit = await runAiFallback(instruction, aiDeps)
  return applyReplan(edit, ctx, 'ai-fallback')
}
