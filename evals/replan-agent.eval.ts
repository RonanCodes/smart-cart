/**
 * Braintrust offline eval for the replan agent.
 *
 * Run: pnpm eval:replan-agent
 * Needs: OPENAI_API_KEY, BRAINTRUST_API_KEY (or .braintrust.json from wizard)
 *
 * @see https://www.braintrust.dev/docs/best-practices/agents
 */
import { Eval } from 'braintrust'
import { replanDataset } from '../src/lib/agent/eval/dataset'
import { runReplanEvalTask } from '../src/lib/agent/eval/run-task'
import { replanScorers } from '../src/lib/agent/eval/scorers'

Eval('Smart Cart', {
  experimentName: 'replan-agent',
  description:
    'Grounded week replan agent: tool choice, compound intents, Dutch phrasing, honest declines, diet filters.',
  data: replanDataset(),
  task: runReplanEvalTask,
  scores: replanScorers,
  metadata: {
    agent: 'replan',
    model: 'gpt-5-mini',
    maxSteps: 8,
  },
})
